import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OrderService } from "../src/application/orderService.js";
import type {
  MerchantQuote,
  MerchantQuoteProvider,
  MerchantQuoteRequest
} from "../src/application/ports/merchantQuoteProvider.js";
import { DomainError } from "../src/domain/domainError.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";
import { OrderRepository } from "../src/infrastructure/db/orderRepository.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");

class QuoteProvider implements MerchantQuoteProvider {
  async getQuote(request: MerchantQuoteRequest): Promise<MerchantQuote> {
    return {
      checkoutId: `checkout-${request.orderId}`,
      sourceProtocol: "MOCK",
      merchant: {
        id: request.merchantId,
        displayName: "Verified Merchant",
        payeeId: "payee-demo",
        verified: true
      },
      items: [
        {
          sku: "BOX",
          name: "Pool box",
          quantity: String(request.totalUnits),
          unitAmountAtomic: "10"
        }
      ],
      assetId: "USDC",
      goodsAmountAtomic: String(request.totalUnits * 10),
      shippingAmountAtomic: "0",
      discountAmountAtomic: "0",
      feeAmountAtomic: "0",
      totalAmountAtomic: String(request.totalUnits * 10),
      expiresAt: "2026-07-25T12:10:00.000Z",
      quoteReference: `quote-${request.orderId}`
    };
  }
}

function createService(database: PoolMateDatabase): {
  repository: OrderRepository;
  service: OrderService;
} {
  let id = 0;
  let token = 0;
  const repository = new OrderRepository(database);
  return {
    repository,
    service: new OrderService({
      repository,
      merchantQuoteProvider: new QuoteProvider(),
      publicBaseUrl: "https://poolmate.example.test",
      payerRef: "sponsored-treasury",
      now: () => NOW,
      createId: () => `cancel-id-${++id}`,
      createToken: () => `cancel-token-${++token}`
    })
  };
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-cancel-"));
  const databasePath = path.join(directory, "poolmate.sqlite");
  const migrationsDir = path.resolve("../migrations");
  const database = new PoolMateDatabase(databasePath, migrationsDir);
  database.migrate();
  return {
    database,
    databasePath,
    migrationsDir,
    ...createService(database)
  };
}

function createOrder(service: OrderService, targetUnits = 1) {
  const group = service.createGroup({
    telegramChatId: `-1000${targetUnits}`,
    title: "Cancellation group"
  });
  return service.createOrder({
    groupId: group.id,
    ownerUserId: "owner-1",
    title: "Cancelable pool",
    targetUnits
  });
}

function tokenFromUrl(value: string): string {
  return new URLSearchParams(new URL(value).hash.slice(1)).get("token")!;
}

async function readyOrder(service: OrderService) {
  const draft = createOrder(service);
  service.publishOrder(draft.id);
  service.claimOrder(draft.id, {
    userId: "participant-1",
    displayName: "Ada",
    units: 1
  });
  const checkout = await service.finalizeCheckout(draft.id, {
    merchantId: "merchant-demo"
  });
  service.confirm(
    tokenFromUrl(checkout.confirmationLinks[0]!.url),
    "participant-1"
  );
  return service.getOrder(draft.id);
}

test("owner cancellation is idempotent, audited, and survives restart", () => {
  const current = fixture();
  const draft = createOrder(current.service, 2);
  current.service.publishOrder(draft.id);

  assert.throws(
    () =>
      current.service.cancelOrder(draft.id, {
        actorType: "telegram_owner",
        actorId: "not-owner",
        reasonCode: "owner_requested"
      }),
    (error) => error instanceof DomainError && error.code === "FORBIDDEN"
  );

  const canceled = current.service.cancelOrder(draft.id, {
    actorType: "telegram_owner",
    actorId: "owner-1",
    reasonCode: "owner_requested",
    sourceIdempotencyKey: "cancel-update-1"
  });
  assert.equal(canceled.state, "CANCELED");
  assert.deepEqual(canceled.cancellation, {
    actorType: "telegram_owner",
    actorId: "owner-1",
    reasonCode: "owner_requested",
    canceledAt: NOW.toISOString()
  });
  assert.deepEqual(
    current.service.cancelOrder(draft.id, {
      actorType: "telegram_owner",
      actorId: "owner-1",
      reasonCode: "owner_requested",
      sourceIdempotencyKey: "cancel-update-2"
    }),
    canceled
  );
  assert.throws(
    () =>
      current.service.claimOrder(draft.id, {
        userId: "participant-1",
        displayName: "Ada",
        units: 1
      }),
    (error) =>
      error instanceof DomainError && error.code === "INVALID_ORDER_STATE"
  );

  current.database.close();
  const reopened = new PoolMateDatabase(
    current.databasePath,
    current.migrationsDir
  );
  reopened.migrate();
  const restarted = createService(reopened).service.getOrder(draft.id);
  assert.equal(restarted.state, "CANCELED");
  assert.deepEqual(restarted.cancellation, canceled.cancellation);
  reopened.close();
});

test("cancellation supersedes pending confirmations", async () => {
  const current = fixture();
  const draft = createOrder(current.service);
  current.service.publishOrder(draft.id);
  current.service.claimOrder(draft.id, {
    userId: "participant-1",
    displayName: "Ada",
    units: 1
  });
  const checkout = await current.service.finalizeCheckout(draft.id, {
    merchantId: "merchant-demo"
  });
  const token = tokenFromUrl(checkout.confirmationLinks[0]!.url);

  current.service.cancelOrder(draft.id, {
    actorType: "admin",
    actorId: "admin-api",
    reasonCode: "admin_requested"
  });
  assert.equal(current.service.getConfirmation(token).status, "superseded");
  assert.throws(
    () => current.service.confirm(token, "participant-1"),
    (error) =>
      error instanceof DomainError && error.code === "CONFIRMATION_SUPERSEDED"
  );
  current.database.close();
});

test("ready cancellation terminates local payment work before submission", async () => {
  const current = fixture();
  const ready = await readyOrder(current.service);
  const canceled = current.service.cancelOrder(ready.id, {
    actorType: "admin",
    actorId: "admin-api",
    reasonCode: "admin_requested"
  });

  assert.equal(canceled.state, "CANCELED");
  assert.equal(canceled.paymentRequest?.status, "failed");
  assert.equal(canceled.paymentProjection?.status, "FAILED");
  assert.equal(canceled.paymentProjection?.errorCode, "ORDER_CANCELED");
  assert.equal(canceled.paymentOutbox?.status, "completed");
  assert.equal(
    current.repository.immediate((transaction) =>
      transaction.claimPaymentSubmission(
        ready.paymentRequest!.id,
        "mock",
        "2026-07-25T12:01:00.000Z",
        NOW.toISOString()
      )
    ),
    "busy"
  );
  current.database.close();
});

test("payment submission claim wins over cancellation and preserves uncertainty", async () => {
  const current = fixture();
  const ready = await readyOrder(current.service);
  assert.equal(
    current.repository.immediate((transaction) =>
      transaction.claimPaymentSubmission(
        ready.paymentRequest!.id,
        "mock",
        "2026-07-25T12:01:00.000Z",
        NOW.toISOString()
      )
    ),
    "claimed"
  );

  assert.throws(
    () =>
      current.service.cancelOrder(ready.id, {
        actorType: "admin",
        actorId: "admin-api",
        reasonCode: "admin_requested"
      }),
    (error) =>
      error instanceof DomainError &&
      error.code === "ORDER_CANCELLATION_NOT_ALLOWED"
  );
  assert.equal(current.service.getOrder(ready.id).state, "READY_FOR_PAYMENT");
  assert.equal(
    current.service.getOrder(ready.id).paymentProjection?.status,
    "SUBMITTING"
  );
  current.database.close();
});
