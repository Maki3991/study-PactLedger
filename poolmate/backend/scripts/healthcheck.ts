import type { BotStatus } from "@poolmate/shared";
import { createServer } from "../src/api/server.js";
import { loadConfig } from "../src/config.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";

const config = loadConfig();
const database = new PoolMateDatabase(
  config.database.path,
  config.database.migrationsDir
);
database.migrate();

const botStatus: BotStatus = config.telegram.token ? "configured" : "disabled";
const app = await createServer({
  config,
  database,
  getBotStatus: () => botStatus
});
const response = await app.inject({ method: "GET", url: "/health" });
const body = response.json();

await app.close();
database.close();

if (response.statusCode !== 200 || body.status !== "ok") {
  console.error(JSON.stringify(body));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(body));
}
