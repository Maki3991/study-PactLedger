import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/api/server.js";
import { loadConfig } from "../src/config.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-p0-"));
  const config = loadConfig(
    {
      POOLMATE_DATABASE_PATH: path.join(directory, "poolmate.sqlite"),
      POOLMATE_MIGRATIONS_DIR: path.resolve("../migrations")
    },
    process.cwd()
  );
  const database = new PoolMateDatabase(
    config.database.path,
    config.database.migrationsDir
  );
  database.migrate();
  return { config, database };
}

test("health reports real database and grammY status", async () => {
  const fixture = createFixture();
  const app = await createServer({
    ...fixture,
    getBotStatus: () => "disabled",
    logger: false
  });

  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().database, {
    status: "ready",
    appliedMigrations: 4,
    pendingMigrations: 0
  });
  assert.deepEqual(response.json().bot, {
    framework: "grammy",
    status: "disabled"
  });

  await app.close();
  fixture.database.close();
});

test("readiness is explicit and liveness has no dependency details", async () => {
  const fixture = createFixture();
  const app = await createServer({
    ...fixture,
    getBotStatus: () => "disabled",
    logger: false
  });

  const live = await app.inject({ method: "GET", url: "/health/live" });
  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(Object.keys(live.json()).sort(), [
    "checkedAt",
    "service",
    "status"
  ]);
  assert.equal(ready.statusCode, 200);

  await app.close();
  fixture.database.close();
});

test("config status never returns configured secrets", async () => {
  const fixture = createFixture();
  fixture.config.telegram.token = "telegram-secret";
  fixture.config.paymentBase.apiKey = "payment-secret";
  fixture.config.paymentBase.url = "https://payments.example.test";
  fixture.config.admin.apiKey = "admin-secret";
  const app = await createServer({
    ...fixture,
    getBotStatus: () => "configured",
    logger: false
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/public/config-status"
  });
  const raw = response.body;
  assert.equal(response.statusCode, 200);
  assert.equal(raw.includes("telegram-secret"), false);
  assert.equal(raw.includes("payment-secret"), false);
  assert.equal(response.json().paymentBase.status, "configured");

  const protectedResponse = await app.inject({
    method: "GET",
    url: "/api/config-status",
    headers: { authorization: "Bearer admin-secret" }
  });
  assert.equal(protectedResponse.statusCode, 200);

  await app.close();
  fixture.database.close();
});

test("unknown routes return a stable error code", async () => {
  const fixture = createFixture();
  const app = await createServer({
    ...fixture,
    getBotStatus: () => "disabled",
    logger: false
  });

  const response = await app.inject({ method: "GET", url: "/missing" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "ROUTE_NOT_FOUND");
  assert.ok(response.json().error.requestId);

  await app.close();
  fixture.database.close();
});

test("admin config status enforces a stable authentication boundary", async () => {
  const fixture = createFixture();
  fixture.config.admin.apiKey = "admin-secret";
  const app = await createServer({
    ...fixture,
    getBotStatus: () => "disabled",
    logger: false
  });

  const missing = await app.inject({
    method: "GET",
    url: "/api/config-status"
  });
  const invalid = await app.inject({
    method: "GET",
    url: "/api/config-status",
    headers: { "x-poolmate-admin-key": "wrong" }
  });
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.json().error.code, "UNAUTHORIZED");
  assert.equal(invalid.statusCode, 403);
  assert.equal(invalid.json().error.code, "FORBIDDEN");

  await app.close();
  fixture.database.close();
});
