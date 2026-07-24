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

const config = loadConfig();
const database = new PoolMateDatabase(
  config.database.path,
  config.database.migrationsDir
);
database.migrate();

const orderService = new OrderService({
  repository: new OrderRepository(database),
  merchantQuoteProvider: new MockMerchantAdapter(),
  publicBaseUrl: config.app.publicBaseUrl,
  payerRef: config.funding.payerRef
});
const botUseCases = new OrderServiceBotUseCases(orderService);

const botRuntime = createBotRuntime({
  token: config.telegram.token,
  allowedUserIds: config.telegram.allowedUserIds,
  apiRoot: config.telegram.apiRoot,
  proxyUrl: config.telegram.proxyUrl,
  useCases: botUseCases
});
const app = await createServer({
  config,
  database,
  orderService,
  identityVerifier: new TelegramWebAppIdentityVerifier({
    botToken: config.telegram.token
  }),
  getBotStatus: () => botRuntime.getStatus()
});

await app.listen({ host: config.app.host, port: config.app.port });
void botRuntime.start();

async function shutdown(signal: string): Promise<void> {
  console.log(`[poolmate] shutting down after ${signal}`);
  await botRuntime.stop();
  await app.close();
  database.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
