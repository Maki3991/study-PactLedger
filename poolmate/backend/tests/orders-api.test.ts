import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/api/server.js";
import { OrderService } from "../src/application/orderService.js";
import { loadConfig } from "../src/config.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";
import { OrderRepository } from "../src/infrastructure/db/orderRepository.js";
import { MockMerchantAdapter } from "../src/infrastructure/merchant/index.js";
import type { ConfirmationIdentityVerifier } from "../src/api/telegramWebAppIdentityVerifier.js";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-api-p1-"));
  const config = loadConfig(
    {
      POOLMATE_ADMIN_API_KEY: "admin-secret",
      POOLMATE_DATABASE_PATH: path.join(directory, "poolmate.sqlite"),
      POOLMATE_MIGRATIONS_DIR: path.resolve("../migrations"),
      POOLMATE_PUBLIC_BASE_URL: "https://poolmate.example.test"
    },
    process.cwd()
  );
  const database = new PoolMateDatabase(
    config.database.path,
    config.database.migrationsDir
  );
  database.migrate();
  const now = () => new Date("2026-07-25T12:00:00.000Z");
  const orderService = new OrderService({
    repository: new OrderRepository(database),
    merchantQuoteProvider: new MockMerchantAdapter({ now }),
    publicBaseUrl: config.app.publicBaseUrl,
    payerRef: config.funding.payerRef,
    now
  });
  const identityVerifier: ConfirmationIdentityVerifier = {
    async verify(initData) {
      const userId = /^valid-(\d+)$/.exec(initData)?.[1];
      if (!userId) throw new Error("invalid test identity");
      return { telegramUserId: userId };
    }
  };
  return { config, database, identityVerifier, orderService };
}

test("P1 APIs enforce admin writes and expose only canonical public state", async () => {
  const current = fixture();
  const app = await createServer({
    ...current,
    getBotStatus: () => "disabled",
    logger: false
  });
  const adminHeaders = { authorization: "Bearer admin-secret" };

  const unauthorized = await app.inject({
    method: "POST",
    url: "/api/groups",
    payload: { telegramChatId: "-10001", title: "Team lunch" }
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.json().error.code, "UNAUTHORIZED");
  assert.equal(
    current.database.read(
      (connection) =>
        (
          connection
            .prepare("SELECT COUNT(*) AS count FROM pm_groups")
            .get() as {
            count: number;
          }
        ).count
    ),
    0
  );

  const group = await app.inject({
    method: "POST",
    url: "/api/groups",
    headers: adminHeaders,
    payload: { telegramChatId: "-10001", title: "Team lunch" }
  });
  assert.equal(group.statusCode, 201);
  assert.equal("telegramChatId" in group.json(), false);

  const created = await app.inject({
    method: "POST",
    url: "/api/orders",
    headers: adminHeaders,
    payload: {
      groupId: group.json().id,
      ownerUserId: "100",
      title: "Noodle set",
      targetUnits: 2,
      sourceIdempotencyKey: "api-create-1"
    }
  });
  const orderId = created.json().id as string;
  assert.equal(created.statusCode, 201);

  const invalidPublish = await app.inject({
    method: "POST",
    url: `/api/orders/${orderId}/publish`,
    headers: { ...adminHeaders, "content-type": "application/json" }
  });
  assert.equal(invalidPublish.statusCode, 400);
  assert.equal(invalidPublish.json().error.code, "INVALID_REQUEST");
  assert.equal(current.orderService.getOrder(orderId).state, "DRAFT");

  const published = await app.inject({
    method: "POST",
    url: `/api/orders/${orderId}/publish`,
    headers: adminHeaders
  });
  assert.equal(published.statusCode, 200, published.body);
  for (const participant of [
    { userId: "101", displayName: "Ada", units: 1 },
    { userId: "102", displayName: "Lin", units: 1 }
  ]) {
    const claimed = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/claims`,
      headers: adminHeaders,
      payload: participant
    });
    assert.equal(claimed.statusCode, 200, claimed.body);
  }

  const checkout = await app.inject({
    method: "POST",
    url: `/api/orders/${orderId}/checkout`,
    headers: { ...adminHeaders, "idempotency-key": "api-quote-1" },
    payload: { merchantId: "merchant-demo" }
  });
  assert.equal(checkout.statusCode, 200);
  const links = checkout.json().confirmationLinks as Array<{
    displayName: string;
    url: string;
  }>;
  assert.equal(links.length, 2);

  const publicList = await app.inject({
    method: "GET",
    url: "/api/public/orders"
  });
  const adminDetail = await app.inject({
    method: "GET",
    url: `/api/orders/${orderId}`,
    headers: adminHeaders
  });
  assert.equal(publicList.statusCode, 404);
  assert.equal(adminDetail.statusCode, 200);
  assert.equal(adminDetail.headers["cache-control"], "private, no-store");
  assert.equal(adminDetail.body.includes('"userId"'), false);
  assert.equal(adminDetail.body.includes("confirmation-token"), false);

  const tokens = new Map(
    links.map((link) => [
      link.displayName,
      new URLSearchParams(new URL(link.url).hash.slice(1)).get("token")!
    ])
  );
  const adaToken = tokens.get("Ada")!;
  const linToken = tokens.get("Lin")!;
  const confirmationView = await app.inject({
    method: "GET",
    url: "/api/public/confirmation",
    headers: { "x-poolmate-confirmation-token": adaToken }
  });
  assert.equal(confirmationView.statusCode, 200);
  assert.equal(confirmationView.headers["cache-control"], "private, no-store");
  assert.equal(confirmationView.headers.vary, "X-PoolMate-Confirmation-Token");
  assert.equal(confirmationView.json().participantDisplayName, "Ada");

  const missingIdentity = await app.inject({
    method: "POST",
    url: "/api/public/confirmation/confirm",
    headers: { "x-poolmate-confirmation-token": adaToken },
    payload: {}
  });
  assert.equal(missingIdentity.statusCode, 401);
  assert.equal(
    missingIdentity.json().error.code,
    "CONFIRMATION_IDENTITY_REQUIRED"
  );
  const wrongActor = await app.inject({
    method: "POST",
    url: "/api/public/confirmation/confirm",
    headers: {
      authorization: "tma valid-999",
      "x-poolmate-confirmation-token": adaToken
    },
    payload: {}
  });
  assert.equal(wrongActor.statusCode, 403);
  assert.equal(wrongActor.json().error.code, "CONFIRMATION_ACTOR_MISMATCH");
  const malicious = await app.inject({
    method: "POST",
    url: "/api/public/confirmation/confirm",
    headers: {
      authorization: "tma valid-101",
      "x-poolmate-confirmation-token": adaToken
    },
    payload: { amountAtomic: "1" }
  });
  assert.equal(malicious.statusCode, 400);
  assert.equal(malicious.json().error.code, "INVALID_REQUEST");

  const first = await app.inject({
    method: "POST",
    url: "/api/public/confirmation/confirm",
    headers: {
      authorization: "tma valid-101",
      "x-poolmate-confirmation-token": adaToken
    },
    payload: {}
  });
  const final = await app.inject({
    method: "POST",
    url: "/api/public/confirmation/confirm",
    headers: {
      authorization: "tma valid-102",
      "x-poolmate-confirmation-token": linToken
    },
    payload: {}
  });
  const replay = await app.inject({
    method: "POST",
    url: "/api/public/confirmation/confirm",
    headers: {
      authorization: "tma valid-102",
      "x-poolmate-confirmation-token": linToken
    },
    payload: {}
  });
  assert.equal(first.json().paymentRequestCreated, false);
  assert.equal(final.json().paymentRequestCreated, true);
  assert.equal(final.json().orderState, "READY_FOR_PAYMENT");
  assert.equal(replay.json().paymentRequestCreated, false);

  const ready = await app.inject({
    method: "GET",
    url: `/api/orders/${orderId}`,
    headers: adminHeaders
  });
  assert.equal(ready.json().state, "READY_FOR_PAYMENT");
  assert.equal(ready.json().paymentRequest.status, "ready");

  await app.close();
  current.database.close();
});

test("confirmation decline requires TMA identity and never creates payment", async () => {
  const current = fixture();
  const group = current.orderService.createGroup({
    telegramChatId: "-10002",
    title: "Decline group"
  });
  const draft = current.orderService.createOrder({
    groupId: group.id,
    ownerUserId: "100",
    title: "Decline checkout",
    targetUnits: 1
  });
  current.orderService.publishOrder(draft.id);
  current.orderService.claimOrder(draft.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  const checkout = await current.orderService.finalizeCheckout(draft.id, {
    merchantId: "merchant-demo"
  });
  const token = new URLSearchParams(
    new URL(checkout.confirmationLinks[0]!.url).hash.slice(1)
  ).get("token")!;
  const app = await createServer({
    ...current,
    getBotStatus: () => "disabled",
    logger: false
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/public/confirmation/decline",
    headers: {
      authorization: "tma valid-101",
      "x-poolmate-confirmation-token": token
    },
    payload: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().confirmation.status, "declined");
  assert.equal(response.json().paymentRequestCreated, false);
  assert.equal(
    current.orderService.getOrder(draft.id).paymentRequest,
    undefined
  );

  await app.close();
  current.database.close();
});
