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

class ExactQuoteProvider implements MerchantQuoteProvider {
  calls = 0;

  constructor(private readonly amountAtomic = "10") {}

  async getQuote(request: MerchantQuoteRequest): Promise<MerchantQuote> {
    this.calls += 1;
    return {
      checkoutId: `checkout:${request.orderId}:${this.calls}`,
      merchant: {
        id: request.merchantId,
        displayName: "Verified Merchant",
        payeeId: "payee-demo",
        verified: true
      },
      items: [
        {
          sku: "NOODLE_SET",
          name: "Noodle set",
          quantity: String(request.totalUnits),
          unitAmountAtomic: "0"
        }
      ],
      assetId: "USDC",
      goodsAmountAtomic: "0",
      shippingAmountAtomic: this.amountAtomic,
      discountAmountAtomic: "0",
      feeAmountAtomic: "0",
      totalAmountAtomic: this.amountAtomic,
      expiresAt: "2026-07-25T12:10:00.000Z",
      quoteReference: `quote:${request.orderId}:${this.calls}`
    };
  }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-orders-"));
  const databasePath = path.join(directory, "poolmate.sqlite");
  const migrationsDir = path.resolve("../migrations");
  const database = new PoolMateDatabase(databasePath, migrationsDir);
  database.migrate();
  const merchant = new ExactQuoteProvider();
  let id = 0;
  let token = 0;
  const service = new OrderService({
    repository: new OrderRepository(database),
    merchantQuoteProvider: merchant,
    publicBaseUrl: "https://poolmate.example.test",
    payerRef: "sponsored-treasury",
    now: () => NOW,
    createId: () => `id-${String(++id).padStart(3, "0")}`,
    createToken: () => `confirmation-token-${++token}`
  });
  return {
    database,
    databasePath,
    directory,
    merchant,
    migrationsDir,
    service
  };
}

function tokenFromUrl(value: string): string {
  return new URLSearchParams(new URL(value).hash.slice(1)).get("token")!;
}

function createCollectingOrder(service: OrderService, targetUnits: number) {
  const group = service.createGroup({
    telegramChatId: "-10001",
    title: "Team lunch"
  });
  const draft = service.createOrder({
    groupId: group.id,
    ownerUserId: "owner-1",
    title: "Noodle set",
    targetUnits,
    sourceIdempotencyKey: "create-update-1"
  });
  return service.publishOrder(draft.id);
}

test("create-order idempotency rejects a different request payload", () => {
  const { database, service } = fixture();
  const group = service.createGroup({
    telegramChatId: "-10001",
    title: "Team lunch"
  });
  const request = {
    groupId: group.id,
    ownerUserId: "owner-1",
    title: "Noodle set",
    targetUnits: 2,
    sourceIdempotencyKey: "create-once"
  };
  const first = service.createOrder(request);
  assert.deepEqual(service.createOrder(request), first);
  assert.throws(
    () => service.createOrder({ ...request, targetUnits: 3 }),
    (error) =>
      error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT"
  );
  database.close();
});

test("exact checkout confirmations create one stable payment request", async () => {
  const { database, service } = fixture();
  const order = createCollectingOrder(service, 3);
  service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  service.claimOrder(order.id, {
    userId: "102",
    displayName: "Lin",
    units: 1
  });
  const full = service.claimOrder(order.id, {
    userId: "103",
    displayName: "Sam",
    units: 1
  });
  assert.equal(full.state, "QUOTE_PENDING");

  const checkout = await service.finalizeCheckout(
    order.id,
    { merchantId: "merchant-demo" },
    "quote-update-1"
  );
  assert.equal(checkout.order.state, "CONFIRMATION_PENDING");
  assert.equal(checkout.order.checkout?.version, 1);
  assert.equal(
    checkout.order.checkout?.allocations.reduce(
      (sum, allocation) => sum + BigInt(allocation.money.amountAtomic),
      0n
    ),
    10n
  );
  assert.deepEqual(
    checkout.order.checkout?.allocations.map(
      (allocation) => allocation.money.amountAtomic
    ),
    ["4", "3", "3"]
  );

  const tokens = checkout.confirmationLinks.map((link) =>
    tokenFromUrl(link.url)
  );
  const stored = database.read((connection) =>
    connection
      .prepare("SELECT token_hash FROM pm_user_confirmations ORDER BY id")
      .all()
  ) as Array<{ token_hash: string }>;
  assert.equal(
    stored.some((row) => tokens.includes(row.token_hash)),
    false,
    "raw confirmation tokens must not be persisted"
  );

  assert.equal(service.confirm(tokens[0]!, "101").paymentRequestCreated, false);
  assert.equal(service.confirm(tokens[1]!, "102").paymentRequestCreated, false);
  const final = service.confirm(tokens[2]!, "103");
  const duplicate = service.confirm(tokens[2]!, "103");
  assert.equal(final.paymentRequestCreated, true);
  assert.equal(duplicate.paymentRequestCreated, false);
  assert.equal(final.orderState, "READY_FOR_PAYMENT");

  const ready = service.getOrder(order.id);
  assert.equal(ready.state, "READY_FOR_PAYMENT");
  assert.equal(ready.paymentRequest?.status, "ready");
  assert.equal(ready.paymentRequest?.money.amountAtomic, "10");
  assert.equal(
    database.read(
      (connection) =>
        (
          connection
            .prepare("SELECT COUNT(*) AS count FROM pm_payment_requests")
            .get() as { count: number }
        ).count
    ),
    1
  );
  database.close();
});

test("checkout revisions supersede old confirmations and quote retries are idempotent", async () => {
  const { database, merchant, service } = fixture();
  const order = createCollectingOrder(service, 1);
  service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });

  const first = await service.finalizeCheckout(
    order.id,
    { merchantId: "merchant-demo" },
    "quote-update-1"
  );
  const duplicate = await service.finalizeCheckout(
    order.id,
    { merchantId: "merchant-demo" },
    "quote-update-1"
  );
  assert.equal(duplicate.order.checkout?.version, 1);
  assert.deepEqual(duplicate.confirmationLinks, []);
  assert.equal(merchant.calls, 1);
  await assert.rejects(
    service.finalizeCheckout(
      order.id,
      { merchantId: "different-merchant" },
      "quote-update-1"
    ),
    (error) =>
      error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.equal(merchant.calls, 1);

  const revised = await service.finalizeCheckout(
    order.id,
    { merchantId: "merchant-demo" },
    "quote-update-2"
  );
  const oldToken = tokenFromUrl(first.confirmationLinks[0]!.url);
  const newToken = tokenFromUrl(revised.confirmationLinks[0]!.url);
  assert.equal(revised.order.checkout?.version, 2);
  assert.equal(service.getConfirmation(oldToken).status, "superseded");
  assert.throws(
    () => service.confirm(oldToken, "101"),
    (error) =>
      error instanceof DomainError && error.code === "CONFIRMATION_SUPERSEDED"
  );
  assert.equal(
    service.confirm(newToken, "101").orderState,
    "READY_FOR_PAYMENT"
  );
  database.close();
});

test("incomplete and over-capacity orders cannot create checkout or payment rows", async () => {
  const { database, merchant, service } = fixture();
  const order = createCollectingOrder(service, 2);
  service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  assert.throws(
    () =>
      service.claimOrder(order.id, {
        userId: "102",
        displayName: "Lin",
        units: 2
      }),
    (error) =>
      error instanceof DomainError && error.code === "CAPACITY_EXCEEDED"
  );
  await assert.rejects(
    service.finalizeCheckout(order.id, { merchantId: "merchant-demo" }),
    (error) =>
      error instanceof DomainError && error.code === "INVALID_ORDER_STATE"
  );
  assert.equal(merchant.calls, 0);
  assert.equal(
    database.read(
      (connection) =>
        (
          connection
            .prepare("SELECT COUNT(*) AS count FROM pm_payment_requests")
            .get() as { count: number }
        ).count
    ),
    0
  );
  database.close();
});

test("quote pending locks participant claims and exits", () => {
  const { database, service } = fixture();
  const order = createCollectingOrder(service, 1);
  const locked = service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  assert.equal(locked.state, "QUOTE_PENDING");
  assert.throws(
    () =>
      service.claimOrder(order.id, {
        userId: "101",
        displayName: "Ada",
        units: 1
      }),
    (error) =>
      error instanceof DomainError && error.code === "INVALID_ORDER_STATE"
  );
  assert.throws(
    () => service.leaveOrder(order.id, "101"),
    (error) =>
      error instanceof DomainError && error.code === "INVALID_ORDER_STATE"
  );
  database.close();
});

test("checkout revisions supersede confirmed and declined evidence", async () => {
  const { database, service } = fixture();
  const order = createCollectingOrder(service, 2);
  service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  service.claimOrder(order.id, {
    userId: "102",
    displayName: "Lin",
    units: 1
  });
  const first = await service.finalizeCheckout(
    order.id,
    { merchantId: "merchant-demo" },
    "quote-confirmed-v1"
  );
  const firstTokens = first.confirmationLinks.map((link) =>
    tokenFromUrl(link.url)
  );
  service.confirm(firstTokens[0]!, "101");
  service.decline(firstTokens[1]!, "102");

  await service.finalizeCheckout(
    order.id,
    { merchantId: "merchant-demo" },
    "quote-confirmed-v2"
  );
  assert.equal(service.getConfirmation(firstTokens[0]!).status, "superseded");
  assert.equal(service.getConfirmation(firstTokens[1]!).status, "superseded");
  database.close();
});

test("decline and actor mismatch cannot create a payment request", async () => {
  const { database, service } = fixture();
  const order = createCollectingOrder(service, 2);
  service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  service.claimOrder(order.id, {
    userId: "102",
    displayName: "Lin",
    units: 1
  });
  const checkout = await service.finalizeCheckout(order.id, {
    merchantId: "merchant-demo"
  });
  const tokens = checkout.confirmationLinks.map((link) =>
    tokenFromUrl(link.url)
  );
  assert.throws(
    () => service.confirm(tokens[0]!, "999"),
    (error) =>
      error instanceof DomainError &&
      error.code === "CONFIRMATION_ACTOR_MISMATCH"
  );
  assert.equal(
    service.decline(tokens[0]!, "101").confirmation.status,
    "declined"
  );
  assert.equal(service.confirm(tokens[1]!, "102").paymentRequestCreated, false);
  assert.equal(service.getOrder(order.id).state, "CONFIRMATION_PENDING");
  assert.equal(service.getOrder(order.id).paymentRequest, undefined);
  database.close();
});

test("claim and leave retries use persisted idempotency records", () => {
  const { database, service } = fixture();
  const order = createCollectingOrder(service, 3);
  const first = service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1,
    sourceIdempotencyKey: "claim-once"
  });
  service.claimOrder(order.id, {
    userId: "102",
    displayName: "Lin",
    units: 1
  });
  assert.deepEqual(
    service.claimOrder(order.id, {
      userId: "101",
      displayName: "Ada",
      units: 1,
      sourceIdempotencyKey: "claim-once"
    }),
    first
  );
  assert.throws(
    () =>
      service.claimOrder(order.id, {
        userId: "101",
        displayName: "Ada",
        units: 2,
        sourceIdempotencyKey: "claim-once"
      }),
    (error) =>
      error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT"
  );

  const left = service.leaveOrder(order.id, "102", "leave-once");
  assert.deepEqual(service.leaveOrder(order.id, "102", "leave-once"), left);
  database.close();
});

test("owner reminder rotates pending tokens without persisting raw secrets", async () => {
  const { database, service } = fixture();
  const order = createCollectingOrder(service, 1);
  service.claimOrder(order.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  const checkout = await service.finalizeCheckout(order.id, {
    merchantId: "merchant-demo"
  });
  const oldToken = tokenFromUrl(checkout.confirmationLinks[0]!.url);
  const reminder = service.reissuePendingConfirmations(
    order.id,
    "owner-1",
    "remind-once"
  );
  assert.equal(reminder.confirmationDeliveries.length, 1);
  assert.equal(
    new URL(reminder.confirmationDeliveries[0]!.url).pathname,
    "/confirm"
  );
  const nextToken = tokenFromUrl(reminder.confirmationDeliveries[0]!.url);
  assert.notEqual(nextToken, oldToken);
  assert.throws(
    () => service.getConfirmation(oldToken),
    (error) =>
      error instanceof DomainError && error.code === "CONFIRMATION_NOT_FOUND"
  );
  assert.equal(service.getConfirmation(nextToken).status, "pending");
  assert.deepEqual(
    service.reissuePendingConfirmations(order.id, "owner-1", "remind-once")
      .confirmationDeliveries,
    []
  );
  database.close();
});
