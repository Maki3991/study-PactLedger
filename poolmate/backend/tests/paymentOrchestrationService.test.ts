import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OrderService } from "../src/application/orderService.js";
import { PaymentOrchestrationService } from "../src/application/paymentOrchestrationService.js";
import type {
  PaymentBaseClient,
  PaymentBaseOutcome
} from "../src/application/ports/paymentBaseClient.js";
import type { MerchantQuoteProvider } from "../src/application/ports/merchantQuoteProvider.js";
import { DomainError } from "../src/domain/domainError.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";
import { OrderRepository } from "../src/infrastructure/db/orderRepository.js";
import { MockPaymentBaseClient } from "../src/infrastructure/payment/mockPaymentBaseClient.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");

class StubPaymentClient implements PaymentBaseClient {
  submitCalls = 0;
  recoverCalls: string[] = [];
  submitResult: PaymentBaseOutcome | Error;
  recoverResult: PaymentBaseOutcome | Error;

  constructor(
    readonly settlementMode: PaymentBaseClient["settlementMode"],
    operationId: string
  ) {
    this.submitResult = {
      status: "unknown",
      operationId,
      settlementMode,
      errorCode: "PAYMENT_OPERATION_UNKNOWN"
    };
    this.recoverResult = this.submitResult;
  }

  async submit(): Promise<PaymentBaseOutcome> {
    this.submitCalls += 1;
    if (this.submitResult instanceof Error) throw this.submitResult;
    return this.submitResult;
  }

  async recover(operationId: string): Promise<PaymentBaseOutcome> {
    this.recoverCalls.push(operationId);
    if (this.recoverResult instanceof Error) throw this.recoverResult;
    return this.recoverResult;
  }
}

function openFixture(databasePath?: string) {
  const directory = databasePath
    ? path.dirname(databasePath)
    : fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-payments-"));
  const resolvedDatabasePath =
    databasePath ?? path.join(directory, "poolmate.sqlite");
  const database = new PoolMateDatabase(
    resolvedDatabasePath,
    path.resolve("../migrations")
  );
  database.migrate();
  const repository = new OrderRepository(database);
  const quoteProvider: MerchantQuoteProvider = {
    async getQuote(request) {
      return {
        checkoutId: `checkout-${request.orderId}`,
        sourceProtocol: "MOCK" as const,
        merchant: {
          id: "merchant-demo",
          displayName: "Verified Merchant",
          payeeId: "merchant-payee",
          verified: true
        },
        items: [
          {
            sku: "LUNCH",
            name: "Lunch",
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
  };
  const orderService = new OrderService({
    repository,
    merchantQuoteProvider: quoteProvider,
    publicBaseUrl: "https://poolmate.example.test",
    payerRef: "sponsored-treasury",
    now: () => NOW
  });
  return {
    database,
    databasePath: resolvedDatabasePath,
    orderService,
    repository
  };
}

async function createReadyOrder(orderService: OrderService) {
  const group = orderService.createGroup({
    telegramChatId: "-10001",
    title: "Lunch group"
  });
  const draft = orderService.createOrder({
    groupId: group.id,
    ownerUserId: "100",
    title: "Lunch",
    targetUnits: 1
  });
  orderService.publishOrder(draft.id);
  orderService.claimOrder(draft.id, {
    userId: "101",
    displayName: "Ada",
    units: 1
  });
  const checkout = await orderService.finalizeCheckout(draft.id, {
    merchantId: "merchant-demo"
  });
  const token = new URLSearchParams(
    new URL(checkout.confirmationLinks[0]!.url).hash.slice(1)
  ).get("token")!;
  orderService.confirm(token, "101");
  return orderService.getOrder(draft.id);
}

test("unconfigured payment stays ready with a blocked durable outbox", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    now: () => NOW
  });

  await assert.rejects(
    service.submit(ready.id),
    (error) =>
      error instanceof DomainError && error.code === "PAYMENT_BASE_UNAVAILABLE"
  );
  const result = current.orderService.getOrder(ready.id);
  assert.equal(result.state, "READY_FOR_PAYMENT");
  assert.equal(result.paymentRequest?.status, "ready");
  assert.equal(result.paymentProjection?.status, "UNAVAILABLE");
  assert.equal(result.paymentProjection?.errorCode, "PAYMENT_BASE_UNAVAILABLE");
  assert.equal(result.paymentOutbox?.status, "blocked");
  current.database.close();
});

test("unknown submission is isolated and recovery uses only the original operation", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  const client = new StubPaymentClient("testnet", operationId);
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const unknown = await service.submit(ready.id);
  assert.equal(unknown.state, "PAYMENT_UNKNOWN");
  assert.equal(unknown.paymentRequest?.status, "unknown");
  assert.equal(unknown.paymentProjection?.status, "UNKNOWN");
  assert.equal(unknown.paymentOutbox?.status, "unknown");
  await service.submit(ready.id);
  assert.equal(client.submitCalls, 1);

  const beforeRecovery = unknown.paymentProjection?.attempts;

  client.recoverResult = {
    status: "confirmed",
    operationId,
    settlementMode: "testnet",
    receiptId: "receipt-1",
    transactionHash: "0xabc",
    explorerUrl: "https://testnet.explorer.example/tx/0xabc",
    confirmedAt: "2026-07-25T12:01:00.000Z"
  };
  const recovered = await service.recover(ready.id);
  assert.deepEqual(client.recoverCalls, [operationId]);
  assert.equal(client.submitCalls, 1);
  assert.equal(recovered.state, "PAID");
  assert.equal(recovered.paymentProjection?.status, "CONFIRMED");
  assert.equal(recovered.paymentProjection?.receipt?.receiptId, "receipt-1");
  assert.equal(
    recovered.paymentProjection?.attempts,
    (beforeRecovery ?? 0) + 1
  );
  current.database.close();
});

test("duplicate concurrent processing claims one submission", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  let release!: (outcome: PaymentBaseOutcome) => void;
  const outcome = new Promise<PaymentBaseOutcome>((resolve) => {
    release = resolve;
  });
  const operationId = ready.paymentProjection!.operationId;
  const client: PaymentBaseClient = {
    settlementMode: "testnet",
    async submit() {
      return outcome;
    },
    async recover() {
      throw new Error("not expected");
    }
  };
  let calls = 0;
  const submit = client.submit.bind(client);
  client.submit = async (request, operationId) => {
    calls += 1;
    return submit(request, operationId);
  };
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const first = service.submit(ready.id);
  const second = await service.submit(ready.id);
  assert.equal(second.paymentProjection?.status, "SUBMITTING");
  assert.equal(calls, 1);
  release({
    status: "submitted",
    operationId,
    settlementMode: "testnet"
  });
  const submitted = await first;
  assert.equal(submitted.state, "PAYMENT_SUBMITTED");
  assert.equal(calls, 1);
  current.database.close();
});

test("a late submit result cannot overwrite a recovered terminal result", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  let release!: (outcome: PaymentBaseOutcome) => void;
  const delayedOutcome = new Promise<PaymentBaseOutcome>((resolve) => {
    release = resolve;
  });
  const client: PaymentBaseClient = {
    settlementMode: "testnet",
    async submit() {
      return delayedOutcome;
    },
    async recover() {
      return {
        status: "confirmed",
        operationId,
        settlementMode: "testnet",
        receiptId: "receipt-race",
        transactionHash: "0xrace",
        explorerUrl: "https://explorer.example/tx/0xrace",
        confirmedAt: "2026-07-25T12:02:00.000Z"
      };
    }
  };
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const submission = service.submit(ready.id);
  current.repository.immediate((transaction) => {
    transaction.updatePaymentState(ready.paymentRequest!.id, {
      requestStatus: "unknown",
      projectionStatus: "UNKNOWN",
      settlementMode: "testnet",
      outboxStatus: "unknown",
      orderState: "PAYMENT_UNKNOWN",
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      availableAt: NOW.toISOString(),
      now: NOW.toISOString()
    });
  });
  const recovered = await service.recover(ready.id);
  assert.equal(recovered.state, "PAID");
  release({
    status: "failed",
    operationId,
    settlementMode: "testnet",
    errorCode: "LATE_FAILURE"
  });
  await submission;
  const final = current.orderService.getOrder(ready.id);
  assert.equal(final.state, "PAID");
  assert.equal(final.paymentProjection?.receipt?.receiptId, "receipt-race");
  current.database.close();
});

test("local Mock confirmation persists a Demo trace and never becomes paid", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: new MockPaymentBaseClient({
      database: current.database,
      allowedPayeeIds: ["merchant-payee"],
      supportedAssetIds: ["USDC"],
      now: () => new Date("2026-07-25T12:01:00.000Z")
    }),
    now: () => new Date("2026-07-25T12:01:00.000Z")
  });

  const result = await service.submit(ready.id);
  assert.equal(result.state, "DEMO_CONFIRMED");
  assert.notEqual(result.state, "PAID");
  assert.equal(result.paymentProjection?.receipt?.kind, "mock");
  current.database.close();
});

test("invalid chain evidence never becomes paid", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const client = new StubPaymentClient(
    "testnet",
    ready.paymentProjection!.operationId
  );
  client.submitResult = {
    status: "confirmed",
    operationId: ready.paymentProjection!.operationId,
    settlementMode: "testnet",
    receiptId: "receipt",
    transactionHash: "hash",
    explorerUrl: "http://insecure.example/tx/hash",
    confirmedAt: "2026-07-25T12:01:00.000Z"
  };
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const result = await service.submit(ready.id);
  assert.equal(result.state, "PAYMENT_UNKNOWN");
  assert.notEqual(result.state, "PAID");
  current.database.close();
});

test("mock confirmation with fabricated chain evidence is isolated as unknown", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const client = new StubPaymentClient(
    "mock",
    ready.paymentProjection!.operationId
  );
  client.submitResult = {
    status: "confirmed",
    operationId: ready.paymentProjection!.operationId,
    settlementMode: "mock",
    receiptId: "mock-receipt",
    transactionHash: "fake-chain-hash",
    explorerUrl: "https://explorer.example/tx/fake-chain-hash",
    confirmedAt: "2026-07-25T12:01:00.000Z"
  };
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const result = await service.submit(ready.id);
  assert.equal(result.state, "PAYMENT_UNKNOWN");
  assert.equal(result.paymentProjection?.status, "UNKNOWN");
  assert.equal(result.paymentProjection?.receipt, undefined);
  current.database.close();
});

test("a settlement-mode mismatch is isolated instead of accepted", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const client = new StubPaymentClient(
    "testnet",
    ready.paymentProjection!.operationId
  );
  client.submitResult = {
    status: "confirmed",
    operationId: ready.paymentProjection!.operationId,
    settlementMode: "mock",
    receiptId: "mock-receipt",
    transactionHash: "mock-hash",
    explorerUrl: "https://mock.example/receipt/mock-hash",
    confirmedAt: "2026-07-25T12:01:00.000Z"
  };
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const result = await service.submit(ready.id);
  assert.equal(result.state, "PAYMENT_UNKNOWN");
  assert.equal(
    result.paymentProjection?.errorCode,
    "PAYMENT_OPERATION_UNKNOWN"
  );
  assert.equal(result.paymentProjection?.settlementMode, "testnet");
  current.database.close();
});

test("approval-required submission remains ready and blocked", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const client = new StubPaymentClient(
    "testnet",
    ready.paymentProjection!.operationId
  );
  client.submitResult = {
    status: "approval_required",
    operationId: ready.paymentProjection!.operationId,
    settlementMode: "testnet",
    errorCode: "PAYMENT_APPROVAL_REQUIRED",
    errorMessage: "External approval is required."
  };
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const result = await service.submit(ready.id);
  assert.equal(result.state, "READY_FOR_PAYMENT");
  assert.equal(result.paymentRequest?.status, "ready");
  assert.equal(result.paymentProjection?.status, "UNAVAILABLE");
  assert.equal(
    result.paymentProjection?.errorCode,
    "PAYMENT_APPROVAL_REQUIRED"
  );
  assert.equal(result.paymentOutbox?.status, "blocked");
  current.database.close();
});

test("adapter errors are normalized by stable payment error codes", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const client = new StubPaymentClient(
    "testnet",
    ready.paymentProjection!.operationId
  );
  client.submitResult = Object.assign(
    new Error("Atomic amount is unsupported."),
    {
      code: "PAYMENT_AMOUNT_UNSUPPORTED"
    }
  );
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  const result = await service.submit(ready.id);
  assert.equal(result.state, "PAYMENT_FAILED");
  assert.equal(
    result.paymentProjection?.errorCode,
    "PAYMENT_AMOUNT_UNSUPPORTED"
  );
  current.database.close();
});

test("explicit failure is terminal and restart preserves the operation identity", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  const databasePath = current.databasePath;
  current.database.close();

  const reopened = openFixture(databasePath);
  const afterRestart = reopened.orderService.getOrder(ready.id);
  assert.equal(afterRestart.paymentProjection?.operationId, operationId);
  const client = new StubPaymentClient("testnet", operationId);
  client.submitResult = {
    status: "failed",
    operationId,
    settlementMode: "testnet",
    errorCode: "PAYMENT_REJECTED",
    errorMessage: "Rejected by policy."
  };
  const service = new PaymentOrchestrationService({
    repository: reopened.repository,
    orderService: reopened.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });
  const failed = await service.submit(ready.id);
  assert.equal(failed.state, "PAYMENT_FAILED");
  assert.equal(failed.paymentRequest?.status, "failed");
  assert.equal(failed.paymentProjection?.errorCode, "PAYMENT_REJECTED");
  await service.submit(ready.id);
  assert.equal(client.submitCalls, 1);
  reopened.database.close();
});

test("restart isolates an interrupted submission and recovers without resubmitting", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  const expiredLease = new Date(NOW.getTime() - 1_000).toISOString();
  current.repository.immediate((transaction) => {
    assert.equal(
      transaction.claimPaymentSubmission(
        ready.paymentRequest!.id,
        "testnet",
        expiredLease,
        NOW.toISOString()
      ),
      "claimed"
    );
  });
  current.database.close();

  const reopened = openFixture(current.databasePath);
  const client = new StubPaymentClient("testnet", operationId);
  client.recoverResult = {
    status: "confirmed",
    operationId,
    settlementMode: "testnet",
    receiptId: "receipt-restart",
    transactionHash: "0xrestart",
    explorerUrl: "https://explorer.example/tx/0xrestart",
    confirmedAt: "2026-07-25T12:02:00.000Z"
  };
  const service = new PaymentOrchestrationService({
    repository: reopened.repository,
    orderService: reopened.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });
  const recovered = await service.recover(ready.id);
  assert.equal(recovered.state, "PAID");
  assert.equal(client.submitCalls, 0);
  assert.deepEqual(client.recoverCalls, [operationId]);
  reopened.database.close();
});

test("recovery scan queries eligible operations and never submits ready payments", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  const client = new StubPaymentClient("testnet", operationId);
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  assert.deepEqual(await service.recoverPending(), {
    attempted: 0,
    succeeded: 0,
    failed: 0
  });
  assert.equal(client.submitCalls, 0);
  assert.deepEqual(client.recoverCalls, []);

  current.repository.immediate((transaction) =>
    transaction.updatePaymentState(ready.paymentRequest!.id, {
      requestStatus: "unknown",
      projectionStatus: "UNKNOWN",
      settlementMode: "testnet",
      outboxStatus: "unknown",
      orderState: "PAYMENT_UNKNOWN",
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      availableAt: NOW.toISOString(),
      now: NOW.toISOString()
    })
  );
  client.recoverResult = {
    status: "failed",
    operationId,
    settlementMode: "testnet",
    errorCode: "PAYMENT_REJECTED"
  };
  assert.deepEqual(await service.recoverPending(), {
    attempted: 1,
    succeeded: 1,
    failed: 0
  });
  assert.equal(client.submitCalls, 0);
  assert.deepEqual(client.recoverCalls, [operationId]);
  assert.equal(current.orderService.getOrder(ready.id).state, "PAYMENT_FAILED");
  current.database.close();
});

test("restart recovers a persisted Mock receipt after the projection update is interrupted", async () => {
  const first = openFixture();
  const ready = await createReadyOrder(first.orderService);
  const operationId = ready.paymentProjection!.operationId;
  const submittedAt = new Date("2026-07-25T12:01:00.000Z");
  const client = new MockPaymentBaseClient({
    database: first.database,
    allowedPayeeIds: ["merchant-payee"],
    supportedAssetIds: ["USDC"],
    now: () => submittedAt
  });
  const claim = first.repository.immediate((transaction) =>
    transaction.claimPaymentSubmission(
      ready.paymentRequest!.id,
      "mock",
      new Date(submittedAt.getTime() + 30_000).toISOString(),
      submittedAt.toISOString()
    )
  );
  assert.equal(claim, "claimed");
  const persisted = await client.submit(ready.paymentRequest!, operationId);
  assert.equal(persisted.status, "confirmed");
  first.database.close();

  const restarted = openFixture(first.databasePath);
  const recoveredAt = new Date("2026-07-25T12:02:00.000Z");
  const service = new PaymentOrchestrationService({
    repository: restarted.repository,
    orderService: restarted.orderService,
    paymentBaseClient: new MockPaymentBaseClient({
      database: restarted.database,
      allowedPayeeIds: ["merchant-payee"],
      supportedAssetIds: ["USDC"],
      now: () => recoveredAt
    }),
    now: () => recoveredAt
  });

  assert.deepEqual(await service.recoverPending(), {
    attempted: 1,
    succeeded: 1,
    failed: 0
  });
  const final = restarted.orderService.getOrder(ready.id);
  assert.equal(final.state, "DEMO_CONFIRMED");
  assert.equal(
    final.paymentProjection?.receipt?.receiptId,
    persisted.status === "confirmed" ? persisted.receiptId : undefined
  );
  const operationCount = restarted.database.read(
    (connection) =>
      (
        connection
          .prepare("SELECT COUNT(*) AS count FROM pm_mock_payment_operations")
          .get() as { count: number }
      ).count
  );
  assert.equal(operationCount, 1);
  restarted.database.close();
});

test("expired payment requests never call the payment base", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const client = new StubPaymentClient(
    "testnet",
    ready.paymentProjection!.operationId
  );
  const afterExpiry = new Date("2026-07-25T12:11:00.000Z");
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => afterExpiry
  });

  await assert.rejects(
    service.submit(ready.id),
    (error) => error instanceof DomainError && error.code === "CHECKOUT_EXPIRED"
  );
  assert.equal(client.submitCalls, 0);
  assert.equal(
    current.orderService.getOrder(ready.id).state,
    "READY_FOR_PAYMENT"
  );
  current.database.close();
});

test("recovery refuses a different settlement mode without calling the base", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  current.repository.immediate((transaction) =>
    transaction.updatePaymentState(ready.paymentRequest!.id, {
      requestStatus: "unknown",
      projectionStatus: "UNKNOWN",
      settlementMode: "testnet",
      outboxStatus: "unknown",
      orderState: "PAYMENT_UNKNOWN",
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      availableAt: NOW.toISOString(),
      now: NOW.toISOString()
    })
  );
  const client = new StubPaymentClient(
    "live",
    ready.paymentProjection!.operationId
  );
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });

  await assert.rejects(
    service.recover(ready.id),
    (error) =>
      error instanceof DomainError &&
      error.code === "PAYMENT_RECOVERY_NOT_ALLOWED"
  );
  assert.deepEqual(client.recoverCalls, []);
  assert.equal(
    current.orderService.getOrder(ready.id).paymentProjection?.settlementMode,
    "testnet"
  );
  current.database.close();
});

test("a late unavailable error cannot roll back a recovered paid order", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  let rejectSubmit!: (error: Error) => void;
  const delayedFailure = new Promise<PaymentBaseOutcome>((_resolve, reject) => {
    rejectSubmit = reject;
  });
  const client: PaymentBaseClient = {
    settlementMode: "testnet",
    async submit() {
      return delayedFailure;
    },
    async recover() {
      return {
        status: "confirmed",
        operationId,
        settlementMode: "testnet",
        receiptId: "receipt-unavailable-race",
        transactionHash: "0xunavailable",
        explorerUrl: "https://explorer.example/tx/0xunavailable",
        confirmedAt: "2026-07-25T12:02:00.000Z"
      };
    }
  };
  const service = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: client,
    now: () => NOW
  });
  const submission = service.submit(ready.id);
  current.repository.immediate((transaction) =>
    transaction.updatePaymentState(ready.paymentRequest!.id, {
      requestStatus: "unknown",
      projectionStatus: "UNKNOWN",
      settlementMode: "testnet",
      outboxStatus: "unknown",
      orderState: "PAYMENT_UNKNOWN",
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      availableAt: NOW.toISOString(),
      now: NOW.toISOString()
    })
  );
  await service.recover(ready.id);
  rejectSubmit(
    new DomainError(
      "PAYMENT_BASE_UNAVAILABLE",
      "The payment base became unavailable.",
      503
    )
  );
  await submission;
  const final = current.orderService.getOrder(ready.id);
  assert.equal(final.state, "PAID");
  assert.equal(
    final.paymentProjection?.receipt?.receiptId,
    "receipt-unavailable-race"
  );
  current.database.close();
});

test("a stale unavailable result cannot overwrite a claimed submission", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  let release!: (outcome: PaymentBaseOutcome) => void;
  const delayed = new Promise<PaymentBaseOutcome>((resolve) => {
    release = resolve;
  });
  const enabled = new PaymentOrchestrationService({
    repository: current.repository,
    orderService: current.orderService,
    paymentBaseClient: {
      settlementMode: "testnet",
      async submit() {
        return delayed;
      },
      async recover() {
        throw new Error("not expected");
      }
    },
    now: () => NOW
  });
  const submission = enabled.submit(ready.id);
  assert.equal(
    current.repository.immediate((transaction) =>
      transaction.updatePaymentStateIfCurrent(
        ready.paymentRequest!.id,
        operationId,
        ["READY", "UNAVAILABLE"],
        {
          requestStatus: "ready",
          projectionStatus: "UNAVAILABLE",
          settlementMode: "disabled",
          outboxStatus: "blocked",
          orderState: "READY_FOR_PAYMENT",
          errorCode: "PAYMENT_BASE_UNAVAILABLE",
          availableAt: NOW.toISOString(),
          now: NOW.toISOString()
        }
      )
    ),
    false
  );
  assert.equal(
    current.orderService.getOrder(ready.id).paymentProjection?.status,
    "SUBMITTING"
  );
  release({ status: "submitted", operationId, settlementMode: "testnet" });
  assert.equal((await submission).state, "PAYMENT_SUBMITTED");
  current.database.close();
});

test("a stale recovery claim cannot reopen a completed outbox", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  const operationId = ready.paymentProjection!.operationId;
  current.repository.immediate((transaction) =>
    transaction.updatePaymentState(ready.paymentRequest!.id, {
      requestStatus: "unknown",
      projectionStatus: "UNKNOWN",
      settlementMode: "testnet",
      outboxStatus: "completed",
      orderState: "PAYMENT_UNKNOWN",
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      availableAt: NOW.toISOString(),
      now: NOW.toISOString()
    })
  );
  current.repository.immediate((transaction) =>
    transaction.updatePaymentState(ready.paymentRequest!.id, {
      requestStatus: "confirmed",
      projectionStatus: "CONFIRMED",
      settlementMode: "testnet",
      outboxStatus: "completed",
      orderState: "PAID",
      receipt: {
        receiptId: "receipt-terminal",
        transactionHash: "0xterminal",
        explorerUrl: "https://explorer.example/tx/0xterminal",
        confirmedAt: "2026-07-25T12:02:00.000Z"
      },
      availableAt: NOW.toISOString(),
      now: NOW.toISOString()
    })
  );

  assert.equal(
    current.repository.immediate((transaction) =>
      transaction.claimPaymentRecovery(
        ready.paymentRequest!.id,
        new Date(NOW.getTime() + 30_000).toISOString(),
        NOW.toISOString()
      )
    ),
    false
  );
  const final = current.orderService.getOrder(ready.id);
  assert.equal(final.paymentProjection?.operationId, operationId);
  assert.equal(final.paymentProjection?.status, "CONFIRMED");
  assert.equal(final.paymentOutbox?.status, "completed");
  current.database.close();
});

test("repository rejects paid state without verifiable chain evidence", async () => {
  const current = openFixture();
  const ready = await createReadyOrder(current.orderService);
  assert.throws(
    () =>
      current.repository.immediate((transaction) =>
        transaction.updatePaymentState(ready.paymentRequest!.id, {
          requestStatus: "confirmed",
          projectionStatus: "CONFIRMED",
          settlementMode: "testnet",
          outboxStatus: "completed",
          orderState: "PAID",
          receipt: {
            receiptId: "receipt-invalid",
            transactionHash: "0xinvalid",
            explorerUrl: "http://insecure.example/tx/0xinvalid",
            confirmedAt: "2026-07-25T12:02:00.000Z"
          },
          availableAt: NOW.toISOString(),
          now: NOW.toISOString()
        })
      ),
    /evidence is incomplete/
  );
  assert.equal(
    current.orderService.getOrder(ready.id).state,
    "READY_FOR_PAYMENT"
  );
  current.database.close();
});
