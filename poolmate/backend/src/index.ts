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
const paymentBaseClient = createHttpPaymentBaseClient({
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

const botRuntime = createBotRuntime({
  token: config.telegram.token,
  userAllowlistEnabled: config.telegram.userAllowlistEnabled,
  allowedUserIds: config.telegram.allowedUserIds,
  apiRoot: config.telegram.apiRoot,
  proxyUrl: config.telegram.proxyUrl,
  useCases: botUseCases
});
const app = await createServer({
  config,
  database,
  orderService,
  paymentOrchestrationService,
  identityVerifier: new TelegramWebAppIdentityVerifier({
    botToken: config.telegram.token
  }),
  getBotStatus: () => botRuntime.getStatus()
});

await app.listen({ host: config.app.host, port: config.app.port });
void botRuntime.start();

async function recoverPayments(): Promise<void> {
  const result = await paymentOrchestrationService.recoverPending();
  if (result.attempted > 0) {
    console.log(
      `[poolmate] payment recovery attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`
    );
  }
}

// Recovery only queries persisted operations; it never creates a new payment.
void recoverPayments().catch((error: unknown) => {
  console.error("[poolmate] payment recovery failed", error);
});
const recoveryTimer = setInterval(() => {
  void recoverPayments().catch((error: unknown) => {
    console.error("[poolmate] payment recovery failed", error);
  });
}, 30_000);
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
