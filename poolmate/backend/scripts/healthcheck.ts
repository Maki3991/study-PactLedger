import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BotStatus } from "@poolmate/shared";
import { createServer } from "../src/api/server.js";
import { loadConfig } from "../src/config.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-health-"));
const config = loadConfig({
  ...process.env,
  POOLMATE_DATABASE_PATH: path.join(directory, "poolmate.sqlite")
});
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
try {
  const response = await app.inject({ method: "GET", url: "/health" });
  const body = response.json();
  if (response.statusCode !== 200 || body.status !== "ok") {
    console.error(JSON.stringify(body));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(body));
  }
} finally {
  await app.close();
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
