import process from "node:process";
import { createServer } from "./api/server.js";
import { createBotRuntime } from "./bot/grammy/createBot.js";
import { loadConfig } from "./config.js";
import { PoolMateDatabase } from "./infrastructure/db/database.js";
import { OrderRepository } from "./infrastructure/db/orderRepository.js";
import { MockMerchantAdapter } from "./infrastructure/merchant/index.js";
import { OrderService } from "./application/orderService.js";
import { OrderServiceBotUseCases } from "./bot/orderServiceBotUseCases.js";
import { TelegramWebAppIdentityVerifier } from "./api/telegramWebAppIdentityVerifier.js";
import { PaymentOrchestrationService } from "./application/paymentOrchestrationService.js";
import { createHttpPaymentBaseClient } from "./infrastructure/payment/httpPaymentBaseClient.js";
import { MockPaymentBaseClient } from "./infrastructure/payment/mockPaymentBaseClient.js";
import {
  MOCK_MERCHANT_ASSET_ID,
  MOCK_MERCHANT_PAYEE_ID
} from "./infrastructure/merchant/mockMerchantAdapter.js";
import { createOrderDraftExtractor } from "./infrastructure/llm/httpOrderDraftExtractor.js";
import {
  formatConfirmationUpdate,
  formatPaymentStatus
} from "./bot/formatter.js";

const config = loadConfig();
const database = new PoolMateDatabase(
  config.database.path,
  config.database.migrationsDir
);
database.migrate();

const orderRepository = new OrderRepository(database);
const orderService = new OrderService({
  repository: orderRepository,
  merchantQuoteProvider: new MockMerchantAdapter(),
  publicBaseUrl: config.app.publicBaseUrl,
  payerRef: config.funding.payerRef
});
const endpointPaths =
  config.paymentBase.submitPath && config.paymentBase.recoverPath
    ? {
        submit: config.paymentBase.submitPath,
        recover: config.paymentBase.recoverPath
      }
    : undefined;
const paymentBaseClient =
  config.paymentBase.settlementMode === "mock"
    ? new MockPaymentBaseClient({
        database,
        allowedPayeeIds: [MOCK_MERCHANT_PAYEE_ID],
        supportedAssetIds: [MOCK_MERCHANT_ASSET_ID]
      })
    : createHttpPaymentBaseClient({
        url: config.paymentBase.url,
        apiKey: config.paymentBase.apiKey,
        settlementMode: config.paymentBase.settlementMode,
        endpointPaths,
        timeoutMs: config.paymentBase.timeoutMs
      });
const paymentOrchestrationService = new PaymentOrchestrationService({
  repository: orderRepository,
  orderService,
  paymentBaseClient
});
const botUseCases = new OrderServiceBotUseCases(orderService);
const draftExtractor = createOrderDraftExtractor(config.llm);

const botRuntime = createBotRuntime({
  // Withholding the token leaves the runtime in "disabled" state instead of
  // competing with the web/ bot for the same long-polling slot.
  token: config.telegram.standaloneBotEnabled
    ? config.telegram.token
    : undefined,
  userAllowlistEnabled: config.telegram.userAllowlistEnabled,
  allowedUserIds: config.telegram.allowedUserIds,
  apiRoot: config.telegram.apiRoot,
  proxyUrl: config.telegram.proxyUrl,
  draftExtractor,
  useCases: botUseCases
});
const app = await createServer({
  config,
  database,
  orderService,
  paymentOrchestrationService,
  getLlmStatus: () => draftExtractor.getStatus(),
  identityVerifier: new TelegramWebAppIdentityVerifier({
    botToken: config.telegram.token
  }),
  notifyConfirmation: async (notification) => {
    const sent = await botRuntime.sendMessage(
      notification.telegramChatId,
      formatConfirmationUpdate(
        notification.actorReference,
        notification.action,
        notification.order
      )
    );
    if (!sent) throw new Error("Telegram bot is unavailable for notification.");
  },
  getBotStatus: () => botRuntime.getStatus()
});

await app.listen({ host: config.app.host, port: config.app.port });
void botRuntime.start();

let paymentSweepRunning = false;

async function processPayments(): Promise<void> {
  if (paymentSweepRunning) return;
  paymentSweepRunning = true;
  try {
    const expiration = await paymentOrchestrationService.expireReadyPayments();
    for (const order of expiration.expired) {
      const telegramChatId = orderService.getTelegramChatIdForOrder(order.id);
      await botRuntime
        .sendMessage(telegramChatId, formatPaymentStatus(order))
        .catch(() => false);
    }
    if (expiration.attempted > 0) {
      console.log(
        `[poolmate] expired ready payments attempted=${expiration.attempted} succeeded=${expiration.succeeded} failed=${expiration.failed}`
      );
    }

    const automatic =
      await paymentOrchestrationService.submitReadyMockPayments();
    for (const order of automatic.completed) {
      const telegramChatId = orderService.getTelegramChatIdForOrder(order.id);
      await botRuntime
        .sendMessage(telegramChatId, formatPaymentStatus(order))
        .catch(() => false);
    }
    if (automatic.attempted > 0) {
      console.log(
        `[poolmate] automatic mock payments attempted=${automatic.attempted} succeeded=${automatic.succeeded} failed=${automatic.failed}`
      );
    }

    const result = await paymentOrchestrationService.recoverPending();
    if (result.attempted > 0) {
      console.log(
        `[poolmate] payment recovery attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`
      );
    }
  } finally {
    paymentSweepRunning = false;
  }
}

void processPayments().catch((error: unknown) => {
  console.error("[poolmate] payment processing failed", error);
});
const recoveryTimer = setInterval(() => {
  void processPayments().catch((error: unknown) => {
    console.error("[poolmate] payment processing failed", error);
  });
}, 1_000);
recoveryTimer.unref();

async function shutdown(signal: string): Promise<void> {
  console.log(`[poolmate] shutting down after ${signal}`);
  clearInterval(recoveryTimer);
  await botRuntime.stop();
  await app.close();
  database.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
