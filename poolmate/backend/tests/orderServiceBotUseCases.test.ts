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
import { OrderServiceBotUseCases } from "../src/bot/orderServiceBotUseCases.js";
import { DomainError } from "../src/domain/domainError.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";
import { OrderRepository } from "../src/infrastructure/db/orderRepository.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");

class BotQuoteProvider implements MerchantQuoteProvider {
  async getQuote(request: MerchantQuoteRequest): Promise<MerchantQuote> {
    const totalAmountAtomic = (
      BigInt(request.totalUnits) * 95_000_000n
    ).toString();
    return {
      checkoutId: `merchant-checkout-${request.orderId}`,
      sourceProtocol: "MOCK",
      merchant: {
        id: request.merchantId,
        displayName: "Demo Merchant #001",
        payeeId: "payee-demo",
        verified: true
      },
      items: [
        {
          sku: "fruit-box",
          name: "Fresh fruit",
          quantity: String(request.totalUnits),
          unitAmountAtomic: "95000000"
        }
      ],
      assetId: "USDC",
      goodsAmountAtomic: totalAmountAtomic,
      shippingAmountAtomic: "0",
      discountAmountAtomic: "0",
      feeAmountAtomic: "0",
      totalAmountAtomic,
      expiresAt: "2026-07-25T12:10:00.000Z",
      quoteReference: `quote:${request.orderId}`
    };
  }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-bot-"));
  const database = new PoolMateDatabase(
    path.join(directory, "poolmate.sqlite"),
    path.resolve("../migrations")
  );
  database.migrate();
  let id = 0;
  let token = 0;
  const service = new OrderService({
    repository: new OrderRepository(database),
    merchantQuoteProvider: new BotQuoteProvider(),
    publicBaseUrl: "https://poolmate.example",
    payerRef: "sponsored-treasury",
    now: () => NOW,
    createId: () => `id-${String(++id).padStart(3, "0")}`,
    createToken: () => `confirmation-token-${++token}`
  });
  return {
    database,
    directory,
    facade: new OrderServiceBotUseCases(service),
    service
  };
}

function actor(userId = "101") {
  return { userId, displayName: `User ${userId}` };
}

function tokenFromFragment(value: string): string {
  return new URLSearchParams(new URL(value).hash.slice(1)).get("token")!;
}

test("bot facade keeps LLM output in DRAFT until the owner publishes or discards", async () => {
  const { database, directory, facade } = fixture();
  try {
    const input = {
      sourceIdempotencyKey: "telegram:update:v1:draft-1",
      telegramChatId: "-500",
      telegramChatTitle: "Friday Pool",
      actor: actor(),
      title: "Fresh fruit",
      targetUnits: 3
    };
    const draft = await facade.createDraft(input);
    assert.equal(draft.state, "DRAFT");
    assert.equal(draft.paymentRequest, undefined);

    await assert.rejects(
      facade.publishDraft({
        sourceIdempotencyKey: "telegram:callback:v1:publish-other",
        telegramChatId: "-500",
        orderId: draft.id,
        actor: actor("202")
      }),
      (error) => error instanceof DomainError && error.code === "FORBIDDEN"
    );
    const published = await facade.publishDraft({
      sourceIdempotencyKey: "telegram:callback:v1:publish-owner",
      telegramChatId: "-500",
      orderId: draft.id,
      actor: actor()
    });
    assert.equal(published.state, "COLLECTING");

    const discardedDraft = await facade.createDraft({
      ...input,
      sourceIdempotencyKey: "telegram:update:v1:draft-2",
      title: "Discard me"
    });
    await assert.rejects(
      facade.discardDraft({
        sourceIdempotencyKey: "telegram:callback:v1:discard-other",
        telegramChatId: "-500",
        orderId: discardedDraft.id,
        actor: actor("202")
      }),
      (error) => error instanceof DomainError && error.code === "FORBIDDEN"
    );
    const discarded = await facade.discardDraft({
      sourceIdempotencyKey: "telegram:callback:v1:discard-owner",
      telegramChatId: "-500",
      orderId: discardedDraft.id,
      actor: actor()
    });
    assert.equal(discarded.state, "CANCELED");
    assert.equal(discarded.checkout, undefined);
    assert.equal(discarded.paymentRequest, undefined);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bot facade enforces group ownership and persists claim/leave idempotency", async () => {
  const { database, directory, facade } = fixture();
  try {
    const order = await facade.createPool({
      sourceIdempotencyKey: "telegram:update:v1:1",
      telegramChatId: "-500",
      telegramChatTitle: "Friday Pool",
      actor: actor(),
      title: "Fresh fruit",
      targetUnits: 3
    });
    const claim = {
      sourceIdempotencyKey: "telegram:update:v1:2",
      telegramChatId: "-500",
      orderId: order.id,
      actor: actor(),
      units: 1
    };

    await facade.claimPool(claim);
    const duplicateClaim = await facade.claimPool(claim);
    assert.equal(duplicateClaim.claimedUnits, 1);
    assert.equal(duplicateClaim.participantCount, 1);
    await assert.rejects(
      facade.claimPool({ ...claim, units: 2 }),
      (error) =>
        error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT"
    );
    await assert.rejects(
      facade.claimPool({ ...claim, telegramChatId: "-999" }),
      (error) => error instanceof DomainError && error.code === "FORBIDDEN"
    );

    const leave = {
      sourceIdempotencyKey: "telegram:callback:v1:leave-1",
      telegramChatId: "-500",
      orderId: order.id,
      actor: actor()
    };
    await facade.leavePool(leave);
    const duplicateLeave = await facade.leavePool(leave);
    assert.equal(duplicateLeave.claimedUnits, 0);
    assert.equal(duplicateLeave.participantCount, 0);

    const operationCount = database.read(
      (connection) =>
        (
          connection
            .prepare("SELECT COUNT(*) AS count FROM pm_operation_idempotency")
            .get() as { count: number }
        ).count
    );
    assert.equal(operationCount, 2);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bot facade restricts quote/remind to the order group and rotates pending links", async () => {
  const { database, directory, facade, service } = fixture();
  try {
    const order = await facade.createPool({
      sourceIdempotencyKey: "telegram:update:v1:10",
      telegramChatId: "-500",
      telegramChatTitle: "Friday Pool",
      actor: actor(),
      title: "Fresh fruit",
      targetUnits: 1
    });
    await facade.claimPool({
      sourceIdempotencyKey: "telegram:update:v1:11",
      telegramChatId: "-500",
      orderId: order.id,
      actor: actor(),
      units: 1
    });
    await assert.rejects(
      facade.quotePool({
        sourceIdempotencyKey: "telegram:update:v1:12",
        telegramChatId: "-999",
        orderId: order.id,
        requestedByUserId: "101"
      }),
      (error) => error instanceof DomainError && error.code === "FORBIDDEN"
    );

    const quote = await facade.quotePool({
      sourceIdempotencyKey: "telegram:update:v1:12",
      telegramChatId: "-500",
      orderId: order.id,
      requestedByUserId: "101"
    });
    const originalToken = tokenFromFragment(
      quote.confirmationDeliveries[0]!.url
    );
    assert.equal(quote.confirmationDeliveries[0]!.telegramUserId, "101");
    await assert.rejects(
      facade.remindPool({
        sourceIdempotencyKey: "telegram:update:v1:owner-check",
        telegramChatId: "-500",
        orderId: order.id,
        requestedByUserId: "202"
      }),
      (error) => error instanceof DomainError && error.code === "FORBIDDEN"
    );

    const reminder = await facade.remindPool({
      sourceIdempotencyKey: "telegram:update:v1:13",
      telegramChatId: "-500",
      orderId: order.id,
      requestedByUserId: "101"
    });
    const rotatedToken = tokenFromFragment(
      reminder.confirmationDeliveries[0]!.url
    );
    assert.notEqual(rotatedToken, originalToken);
    assert.throws(
      () => service.getConfirmation(originalToken),
      (error) =>
        error instanceof DomainError && error.code === "CONFIRMATION_NOT_FOUND"
    );

    const duplicateReminder = await facade.remindPool({
      sourceIdempotencyKey: "telegram:update:v1:13",
      telegramChatId: "-500",
      orderId: order.id,
      requestedByUserId: "101"
    });
    assert.deepEqual(duplicateReminder.confirmationDeliveries, []);
    await assert.rejects(
      facade.remindPool({
        sourceIdempotencyKey: "telegram:update:v1:14",
        telegramChatId: "-999",
        orderId: order.id,
        requestedByUserId: "101"
      }),
      (error) => error instanceof DomainError && error.code === "FORBIDDEN"
    );
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
