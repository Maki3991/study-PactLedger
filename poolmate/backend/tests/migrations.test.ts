import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";

function fixtureDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-migrations-"));
}

test("migration runner rejects a missing migration directory", () => {
  const directory = fixtureDirectory();
  const database = new PoolMateDatabase(
    path.join(directory, "poolmate.sqlite"),
    path.join(directory, "missing")
  );

  assert.throws(() => database.migrate(), /does not exist/);
  assert.equal(database.migrationState().failed, true);
  database.close();
});

test("migration runner is idempotent and rejects changed applied SQL", () => {
  const directory = fixtureDirectory();
  const migrationsDir = path.join(directory, "migrations");
  fs.mkdirSync(migrationsDir);
  const migrationPath = path.join(migrationsDir, "0001_test.sql");
  fs.writeFileSync(
    migrationPath,
    "CREATE TABLE pm_test (id TEXT PRIMARY KEY);\n"
  );
  const database = new PoolMateDatabase(
    path.join(directory, "poolmate.sqlite"),
    migrationsDir
  );

  database.migrate();
  database.migrate();
  assert.deepEqual(database.migrationState(), {
    applied: 1,
    pending: 0,
    failed: false
  });

  fs.writeFileSync(
    migrationPath,
    "CREATE TABLE pm_test (id TEXT PRIMARY KEY, changed TEXT);\n"
  );
  assert.throws(() => database.migrate(), /checksum changed/);
  assert.equal(database.migrationState().failed, true);
  database.close();
});

test("0003 invalidates legacy checkout evidence and requires a new quote", () => {
  const directory = fixtureDirectory();
  const migrationsDir = path.join(directory, "migrations");
  const sourceMigrations = path.resolve("../migrations");
  fs.mkdirSync(migrationsDir);
  for (const filename of ["0001_system_meta.sql", "0002_orders.sql"]) {
    fs.copyFileSync(
      path.join(sourceMigrations, filename),
      path.join(migrationsDir, filename)
    );
  }
  const database = new PoolMateDatabase(
    path.join(directory, "poolmate.sqlite"),
    migrationsDir
  );
  database.migrate();
  database.read((connection) => {
    connection
      .prepare(
        `INSERT INTO pm_groups VALUES
         ('group-1', '-10001', 'Group', '2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_orders VALUES
         ('order-1', 'group-1', '100', 'Order', 'CONFIRMATION_PENDING',
          'sponsored_demo', 1, NULL, '2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_participants VALUES
         ('participant-1', 'order-1', '101', 'Ada', 1,
          '2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_checkout_snapshots VALUES
         ('checkout-1', 'order-1', 1, 'hash-1', 'merchant-demo', 'Merchant',
          'payee-demo', 'USDC', '95000000', '2026-07-25T12:10:00Z',
          'quote-1', NULL, '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_user_confirmations VALUES
         ('confirmation-1', 'checkout-1', 'participant-1', 'token-hash',
          'confirmed', '2026-07-25T12:01:00Z', '2026-07-25T12:00:00Z',
          '2026-07-25T12:01:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_allocations VALUES
         ('allocation-1', 'checkout-1', 'participant-1', 'USDC', '95000000',
          '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_confirmation_sets VALUES
         ('set-1', 'order-1', 'checkout-1', '2026-07-25T12:01:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_payment_requests VALUES
         ('request-1', 'order-1', 'checkout-1', 1, 'hash-1', 'set-1',
          'legacy-idempotency', 'payer-demo', 'payee-demo', 'USDC', '95000000',
          '2026-07-25T12:10:00Z', 'ready', '2026-07-25T12:01:00Z',
          '2026-07-25T12:01:00Z')`
      )
      .run();
  });

  fs.copyFileSync(
    path.join(sourceMigrations, "0003_checkout_security.sql"),
    path.join(migrationsDir, "0003_checkout_security.sql")
  );
  database.migrate();

  database.read((connection) => {
    const checkout = connection
      .prepare(
        `SELECT hash_algorithm, canonicalization_version, is_canonical,
                goods_amount_atomic
         FROM pm_checkout_snapshots WHERE id = 'checkout-1'`
      )
      .get() as Record<string, unknown>;
    const confirmation = connection
      .prepare(
        "SELECT status FROM pm_user_confirmations WHERE id = 'confirmation-1'"
      )
      .get() as { status: string };
    const order = connection
      .prepare("SELECT state FROM pm_orders WHERE id = 'order-1'")
      .get() as { state: string };
    const paymentRequest = connection
      .prepare("SELECT status FROM pm_payment_requests WHERE id = 'request-1'")
      .get() as { status: string };
    assert.deepEqual(checkout, {
      hash_algorithm: "LEGACY",
      canonicalization_version: "legacy-unversioned",
      is_canonical: 0,
      goods_amount_atomic: "95000000"
    });
    assert.equal(confirmation.status, "superseded");
    assert.equal(order.state, "QUOTE_PENDING");
    assert.equal(paymentRequest.status, "failed");
    const oldTokenCount = connection
      .prepare(
        "SELECT COUNT(*) AS count FROM pm_user_confirmations WHERE token_hash = 'token-hash'"
      )
      .get() as { count: number };
    assert.equal(oldTokenCount.count, 0);
    assert.ok(
      connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pm_operation_idempotency'"
        )
        .get()
    );
  });
  database.close();
});
