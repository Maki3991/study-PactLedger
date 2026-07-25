import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";

function fixtureDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-migrations-"));
}

function openMigratedDatabase(): PoolMateDatabase {
  const directory = fixtureDirectory();
  const database = new PoolMateDatabase(
    path.join(directory, "poolmate.sqlite"),
    path.resolve("../migrations")
  );
  database.migrate();
  return database;
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

test("0005 does not trust legacy confirmed states without receipt evidence", () => {
  const directory = fixtureDirectory();
  const migrationsDir = path.join(directory, "migrations");
  const sourceMigrations = path.resolve("../migrations");
  fs.mkdirSync(migrationsDir);
  for (const filename of [
    "0001_system_meta.sql",
    "0002_orders.sql",
    "0003_checkout_security.sql",
    "0004_idempotency_request_hashes.sql"
  ]) {
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
        `INSERT INTO pm_orders
         (id, group_id, owner_user_id, title, state, funding_mode, target_units,
          created_at, updated_at)
         VALUES ('order-1', 'group-1', '100', 'Order', 'PAID',
          'sponsored_demo', 1, '2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_checkout_snapshots
         (id, order_id, version, hash, merchant_id, merchant_display_name,
          payee_id, asset_id, total_amount_atomic, expires_at, quote_reference,
          created_at, hash_algorithm, canonicalization_version, is_canonical,
          items_json, goods_amount_atomic, shipping_amount_atomic,
          discount_amount_atomic, fee_amount_atomic)
         VALUES ('checkout-1', 'order-1', 1, 'hash-1', 'merchant-demo',
          'Merchant', 'payee-demo', 'USDC', '10', '2026-07-25T12:10:00Z',
          'quote-1', '2026-07-25T12:00:00Z', 'SHA-256',
          'poolmate-checkout-json-v1', 1, '[]', '10', '0', '0', '0')`
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
          'stable-key', 'payer-demo', 'payee-demo', 'USDC', '10',
          '2026-07-25T12:10:00Z', 'confirmed', '2026-07-25T12:01:00Z',
          '2026-07-25T12:01:00Z')`
      )
      .run();
  });
  fs.copyFileSync(
    path.join(sourceMigrations, "0005_payment_orchestration.sql"),
    path.join(migrationsDir, "0005_payment_orchestration.sql")
  );
  database.migrate();
  database.read((connection) => {
    assert.equal(
      (
        connection
          .prepare("SELECT state FROM pm_orders WHERE id = 'order-1'")
          .get() as { state: string }
      ).state,
      "PAYMENT_UNKNOWN"
    );
    assert.deepEqual(
      connection
        .prepare(
          `SELECT status, error_code, receipt_id
           FROM pm_payment_projections WHERE payment_request_id = 'request-1'`
        )
        .get(),
      {
        status: "UNKNOWN",
        error_code: "LEGACY_PAYMENT_EVIDENCE_UNAVAILABLE",
        receipt_id: null
      }
    );
    assert.equal(
      (
        connection.prepare("SELECT last_error_code FROM pm_outbox").get() as {
          last_error_code: string | null;
        }
      ).last_error_code,
      "LEGACY_PAYMENT_EVIDENCE_UNAVAILABLE"
    );
  });
  database.close();
});

test("0005 isolates legacy submitted rows for recovery", () => {
  const directory = fixtureDirectory();
  const migrationsDir = path.join(directory, "migrations");
  const sourceMigrations = path.resolve("../migrations");
  fs.mkdirSync(migrationsDir);
  for (const filename of [
    "0001_system_meta.sql",
    "0002_orders.sql",
    "0003_checkout_security.sql",
    "0004_idempotency_request_hashes.sql"
  ]) {
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
        `INSERT INTO pm_orders
         (id, group_id, owner_user_id, title, state, funding_mode, target_units,
          created_at, updated_at)
         VALUES ('order-1', 'group-1', '100', 'Order', 'PAYMENT_SUBMITTED',
          'sponsored_demo', 1, '2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_checkout_snapshots
         (id, order_id, version, hash, merchant_id, merchant_display_name,
          payee_id, asset_id, total_amount_atomic, expires_at, quote_reference,
          created_at, hash_algorithm, canonicalization_version, is_canonical,
          items_json, goods_amount_atomic, shipping_amount_atomic,
          discount_amount_atomic, fee_amount_atomic)
         VALUES ('checkout-1', 'order-1', 1, 'hash-1', 'merchant-demo',
          'Merchant', 'payee-demo', 'USDC', '10', '2026-07-25T12:10:00Z',
          'quote-1', '2026-07-25T12:00:00Z', 'SHA-256',
          'poolmate-checkout-json-v1', 1, '[]', '10', '0', '0', '0')`
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
          'stable-key', 'payer-demo', 'payee-demo', 'USDC', '10',
          '2026-07-25T12:10:00Z', 'submitted', '2026-07-25T12:01:00Z',
          '2026-07-25T12:01:00Z')`
      )
      .run();
  });
  fs.copyFileSync(
    path.join(sourceMigrations, "0005_payment_orchestration.sql"),
    path.join(migrationsDir, "0005_payment_orchestration.sql")
  );
  database.migrate();
  database.read((connection) => {
    assert.deepEqual(
      connection
        .prepare(
          `SELECT r.status AS request_status, p.status AS projection_status,
                  o.status AS outbox_status, orders.state AS order_state
           FROM pm_payment_requests r
           JOIN pm_payment_projections p ON p.payment_request_id = r.id
           JOIN pm_outbox o ON o.payment_request_id = r.id
           JOIN pm_orders orders ON orders.id = r.order_id`
        )
        .get(),
      {
        request_status: "unknown",
        projection_status: "UNKNOWN",
        outbox_status: "unknown",
        order_state: "PAYMENT_UNKNOWN"
      }
    );
  });
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

test("0005 backfills one stable projection and outbox per payment request", () => {
  const directory = fixtureDirectory();
  const migrationsDir = path.join(directory, "migrations");
  const sourceMigrations = path.resolve("../migrations");
  fs.mkdirSync(migrationsDir);
  for (const filename of [
    "0001_system_meta.sql",
    "0002_orders.sql",
    "0003_checkout_security.sql",
    "0004_idempotency_request_hashes.sql"
  ]) {
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
        `INSERT INTO pm_orders
         (id, group_id, owner_user_id, title, state, funding_mode, target_units,
          created_at, updated_at)
         VALUES ('order-1', 'group-1', '100', 'Order', 'READY_FOR_PAYMENT',
          'sponsored_demo', 1, '2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO pm_checkout_snapshots
         (id, order_id, version, hash, merchant_id, merchant_display_name,
          payee_id, asset_id, total_amount_atomic, expires_at, quote_reference,
          created_at, hash_algorithm, canonicalization_version, is_canonical,
          items_json, goods_amount_atomic, shipping_amount_atomic,
          discount_amount_atomic, fee_amount_atomic)
         VALUES ('checkout-1', 'order-1', 1, 'hash-1', 'merchant-demo',
          'Merchant', 'payee-demo', 'USDC', '10', '2026-07-25T12:10:00Z',
          'quote-1', '2026-07-25T12:00:00Z', 'SHA-256',
          'poolmate-checkout-json-v1', 1, '[]', '10', '0', '0', '0')`
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
          'stable-key', 'payer-demo', 'payee-demo', 'USDC', '10',
          '2026-07-25T12:10:00Z', 'ready', '2026-07-25T12:01:00Z',
          '2026-07-25T12:01:00Z')`
      )
      .run();
  });

  fs.copyFileSync(
    path.join(sourceMigrations, "0005_payment_orchestration.sql"),
    path.join(migrationsDir, "0005_payment_orchestration.sql")
  );
  database.migrate();
  database.read((connection) => {
    assert.deepEqual(
      connection
        .prepare(
          "SELECT operation_id, status, settlement_mode FROM pm_payment_projections"
        )
        .get(),
      {
        operation_id: "pmop_stable-key",
        status: "READY",
        settlement_mode: "disabled"
      }
    );
    assert.deepEqual(
      connection.prepare("SELECT operation_id, status FROM pm_outbox").get(),
      { operation_id: "pmop_stable-key", status: "pending" }
    );
    assert.equal(
      (
        connection.prepare("SELECT last_error_code FROM pm_outbox").get() as {
          last_error_code: string | null;
        }
      ).last_error_code,
      null
    );
  });
  database.close();
});

test("0006 rejects Mock confirmation with fabricated chain evidence", () => {
  const database = openMigratedDatabase();
  const now = "2026-07-25T12:00:00.000Z";
  database.immediate((connection) => {
    connection
      .prepare(
        `INSERT INTO pm_groups
         (id, telegram_chat_id, title, created_at, updated_at)
         VALUES ('group-mock', '-10006', 'Mock group', ?, ?)`
      )
      .run(now, now);
    connection
      .prepare(
        `INSERT INTO pm_orders
         (id, group_id, owner_user_id, title, state, funding_mode,
          target_units, created_at, updated_at)
         VALUES ('order-mock', 'group-mock', '100', 'Mock order',
                 'DRAFT', 'sponsored_demo', 1, ?, ?)`
      )
      .run(now, now);
    connection
      .prepare(
        `INSERT INTO pm_checkout_snapshots
         (id, order_id, version, hash, merchant_id, merchant_display_name,
          payee_id, hash_algorithm, canonicalization_version, is_canonical,
          items_json, asset_id, goods_amount_atomic, shipping_amount_atomic,
          discount_amount_atomic, fee_amount_atomic, total_amount_atomic,
          expires_at, quote_reference, created_at)
         VALUES ('checkout-mock', 'order-mock', 1, 'hash', 'merchant-demo',
                 'Merchant', 'payee-demo', 'SHA-256',
                 'poolmate-checkout-json-v1', 1, '[]', 'USDC', '1', '0',
                 '0', '0', '1', '2026-07-25T12:10:00.000Z', 'quote', ?)`
      )
      .run(now);
    connection
      .prepare(
        `INSERT INTO pm_confirmation_sets
         (id, order_id, checkout_id, created_at)
         VALUES ('set-mock', 'order-mock', 'checkout-mock', ?)`
      )
      .run(now);
    connection
      .prepare(
        `INSERT INTO pm_payment_requests
         (id, order_id, checkout_id, checkout_version, checkout_hash,
          confirmation_set_id, idempotency_key, payer_ref, payee_id, asset_id,
          amount_atomic, expires_at, status, created_at, updated_at)
         VALUES ('request-mock', 'order-mock', 'checkout-mock', 1, 'hash',
                 'set-mock', 'key-mock', 'payer', 'payee-demo', 'USDC', '1',
                 '2026-07-25T12:10:00.000Z', 'ready', ?, ?)`
      )
      .run(now, now);
  });

  assert.throws(() =>
    database.immediate((connection) =>
      connection
        .prepare(
          `INSERT INTO pm_payment_projections
           (payment_request_id, operation_id, status, settlement_mode,
            receipt_id, transaction_hash, explorer_url, confirmed_at,
            attempts, created_at, updated_at)
           VALUES ('request-mock', 'operation-mock', 'DEMO_CONFIRMED', 'mock',
                   'receipt-mock', 'fake-hash', 'https://explorer.example/fake',
                   ?, 0, ?, ?)`
        )
        .run(now, now, now)
    )
  );
  database.close();
});
