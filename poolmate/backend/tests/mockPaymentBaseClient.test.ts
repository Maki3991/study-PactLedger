import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PoolMatePaymentRequest } from "@poolmate/shared";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";
import { MockPaymentBaseClient } from "../src/infrastructure/payment/mockPaymentBaseClient.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const REQUEST: PoolMatePaymentRequest = {
  id: "request-1",
  orderId: "order-1",
  checkoutId: "checkout-1",
  checkoutVersion: 1,
  checkoutHash: "sha256-checkout",
  confirmationSetId: "confirmation-set-1",
  idempotencyKey: "stable-payment-key",
  payerRef: "sponsored-treasury",
  payeeId: "payee-demo",
  money: { assetId: "USDC", amountAtomic: "285000000" },
  expiresAt: "2026-07-25T12:10:00.000Z",
  status: "ready",
  createdAt: "2026-07-25T11:59:00.000Z"
};
const OPERATION_ID = `pmop_${REQUEST.idempotencyKey}`;

function openDatabase(databasePath?: string): PoolMateDatabase {
  const resolvedPath =
    databasePath ??
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-mock-payment-")),
      "poolmate.sqlite"
    );
  const database = new PoolMateDatabase(
    resolvedPath,
    path.resolve("../migrations")
  );
  database.migrate();
  return database;
}

function seedPaymentRequest(
  database: PoolMateDatabase,
  request: PoolMatePaymentRequest
): void {
  database.immediate((connection) => {
    connection
      .prepare(
        `INSERT INTO pm_groups
         (id, telegram_chat_id, title, created_at, updated_at)
         VALUES ('group-1', '-10001', 'Group', ?, ?)`
      )
      .run(request.createdAt, request.createdAt);
    connection
      .prepare(
        `INSERT INTO pm_orders
         (id, group_id, owner_user_id, title, state, funding_mode,
          target_units, created_at, updated_at)
         VALUES (?, 'group-1', '100', 'Order', 'READY_FOR_PAYMENT',
                 'sponsored_demo', 1, ?, ?)`
      )
      .run(request.orderId, request.createdAt, request.createdAt);
    connection
      .prepare(
        `INSERT INTO pm_checkout_snapshots
         (id, order_id, version, hash, merchant_id, merchant_display_name,
          payee_id, hash_algorithm, canonicalization_version, is_canonical,
          items_json, asset_id, goods_amount_atomic, shipping_amount_atomic,
          discount_amount_atomic, fee_amount_atomic, total_amount_atomic,
          expires_at, quote_reference, created_at)
         VALUES (?, ?, ?, ?, 'merchant-demo', 'Merchant', ?, 'SHA-256',
                 'poolmate-checkout-json-v1', 1, '[]', ?, ?, '0', '0', '0', ?,
                 ?, 'quote', ?)`
      )
      .run(
        request.checkoutId,
        request.orderId,
        request.checkoutVersion,
        request.checkoutHash,
        request.payeeId,
        request.money.assetId,
        request.money.amountAtomic,
        request.money.amountAtomic,
        request.expiresAt,
        request.createdAt
      );
    connection
      .prepare(
        `INSERT INTO pm_confirmation_sets
         (id, order_id, checkout_id, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        request.confirmationSetId,
        request.orderId,
        request.checkoutId,
        request.createdAt
      );
    connection
      .prepare(
        `INSERT INTO pm_payment_requests
         (id, order_id, checkout_id, checkout_version, checkout_hash,
          confirmation_set_id, idempotency_key, payer_ref, payee_id, asset_id,
          amount_atomic, expires_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.id,
        request.orderId,
        request.checkoutId,
        request.checkoutVersion,
        request.checkoutHash,
        request.confirmationSetId,
        request.idempotencyKey,
        request.payerRef,
        request.payeeId,
        request.money.assetId,
        request.money.amountAtomic,
        request.expiresAt,
        request.status,
        request.createdAt,
        request.createdAt
      );
  });
}

function client(database: PoolMateDatabase, now = () => NOW) {
  return new MockPaymentBaseClient({
    database,
    allowedPayeeIds: ["payee-demo"],
    supportedAssetIds: ["USDC"],
    now
  });
}

test("Mock submission persists one deterministic non-chain receipt", async () => {
  const database = openDatabase();
  seedPaymentRequest(database, REQUEST);
  const paymentClient = client(database);

  const first = await paymentClient.submit(REQUEST, OPERATION_ID);
  const replay = await paymentClient.submit(REQUEST, OPERATION_ID);
  const recovered = await paymentClient.recover(OPERATION_ID);

  assert.deepEqual(replay, first);
  assert.deepEqual(recovered, first);
  assert.equal(first.status, "confirmed");
  if (first.status === "confirmed") {
    assert.match(first.receiptId, /^pmrc_mock_[a-f0-9]{32}$/);
    assert.equal(first.transactionHash, "");
    assert.equal(first.explorerUrl, "");
    assert.equal(first.confirmedAt, NOW.toISOString());
  }
  const counts = database.read((connection) => ({
    operations: Number(
      (
        connection
          .prepare("SELECT COUNT(*) AS count FROM pm_mock_payment_operations")
          .get() as { count: number }
      ).count
    ),
    decisions: Number(
      (
        connection
          .prepare("SELECT COUNT(*) AS count FROM pm_mock_policy_decisions")
          .get() as { count: number }
      ).count
    ),
    receipts: Number(
      (
        connection
          .prepare("SELECT COUNT(*) AS count FROM pm_mock_settlement_receipts")
          .get() as { count: number }
      ).count
    )
  }));
  assert.deepEqual(counts, { operations: 1, decisions: 1, receipts: 1 });
  assert.throws(() =>
    database.immediate((connection) =>
      connection
        .prepare(
          "UPDATE pm_mock_policy_decisions SET reason = 'changed' WHERE operation_id = ?"
        )
        .run(OPERATION_ID)
    )
  );
  database.close();
});

test("Mock policy rejects payee, asset, amount, and expiry before settlement", async () => {
  const scenarios: Array<{
    name: string;
    request: PoolMatePaymentRequest;
    code: string;
  }> = [
    {
      name: "payee",
      request: { ...REQUEST, payeeId: "payee-attacker" },
      code: "PAYMENT_PAYEE_NOT_ALLOWED"
    },
    {
      name: "asset",
      request: { ...REQUEST, money: { ...REQUEST.money, assetId: "USDT" } },
      code: "PAYMENT_ASSET_UNSUPPORTED"
    },
    {
      name: "zero amount",
      request: { ...REQUEST, money: { ...REQUEST.money, amountAtomic: "0" } },
      code: "PAYMENT_AMOUNT_UNSUPPORTED"
    },
    {
      name: "expired",
      request: { ...REQUEST, expiresAt: NOW.toISOString() },
      code: "PAYMENT_REQUEST_EXPIRED"
    }
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const database = openDatabase();
    const operationId = `${OPERATION_ID}-${index}`;
    const request = {
      ...scenario.request,
      idempotencyKey: `${REQUEST.idempotencyKey}-${index}`
    };
    seedPaymentRequest(database, request);
    const outcome = await client(database).submit(request, operationId);
    assert.equal(outcome.status, "failed", scenario.name);
    assert.equal(outcome.errorCode, scenario.code, scenario.name);
    const receiptCount = database.read(
      (connection) =>
        (
          connection
            .prepare(
              "SELECT COUNT(*) AS count FROM pm_mock_settlement_receipts"
            )
            .get() as { count: number }
        ).count
    );
    assert.equal(receiptCount, 0, scenario.name);
    database.close();
  }
});

test("Mock operation identity is immutable under a conflicting replay", async () => {
  const database = openDatabase();
  seedPaymentRequest(database, REQUEST);
  const paymentClient = client(database);
  const confirmed = await paymentClient.submit(REQUEST, OPERATION_ID);
  const conflicting = await paymentClient.submit(
    { ...REQUEST, payeeId: "changed-payee" },
    OPERATION_ID
  );

  assert.equal(conflicting.status, "failed");
  assert.equal(conflicting.errorCode, "PAYMENT_OPERATION_CONFLICT");
  assert.deepEqual(await paymentClient.recover(OPERATION_ID), confirmed);
  database.close();
});

test("An invalid operation identity cannot poison the canonical submission", async () => {
  const database = openDatabase();
  seedPaymentRequest(database, REQUEST);
  const paymentClient = client(database);

  const rejected = await paymentClient.submit(REQUEST, "pmop_wrong");
  const confirmed = await paymentClient.submit(REQUEST, OPERATION_ID);

  assert.equal(rejected.status, "failed");
  assert.equal(rejected.errorCode, "PAYMENT_OPERATION_CONFLICT");
  assert.equal(confirmed.status, "confirmed");
  const operations = database.read(
    (connection) =>
      (
        connection
          .prepare("SELECT COUNT(*) AS count FROM pm_mock_payment_operations")
          .get() as { count: number }
      ).count
  );
  assert.equal(operations, 1);
  database.close();
});

test("Mock recovery reads the original persisted operation after restart", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "poolmate-mock-restart-")
  );
  const databasePath = path.join(directory, "poolmate.sqlite");
  const firstDatabase = openDatabase(databasePath);
  seedPaymentRequest(firstDatabase, REQUEST);
  const submitted = await client(firstDatabase).submit(REQUEST, OPERATION_ID);
  firstDatabase.close();

  const restartedDatabase = openDatabase(databasePath);
  const restartedClient = client(
    restartedDatabase,
    () => new Date("2026-07-25T12:05:00.000Z")
  );
  assert.deepEqual(await restartedClient.recover(OPERATION_ID), submitted);
  const missing = await restartedClient.recover("pmop_missing");
  assert.equal(missing.status, "unknown");
  assert.equal(missing.errorCode, "PAYMENT_OPERATION_UNKNOWN");
  restartedDatabase.close();
});
