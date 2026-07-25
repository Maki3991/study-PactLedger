import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrderDetailView,
  PaymentProjectionStatus
} from "@poolmate/shared";
import { formatPaymentStatus } from "../src/bot/formatter.js";

function order(status?: PaymentProjectionStatus): OrderDetailView {
  return {
    id: "order-1",
    title: "Friday fruit",
    group: {
      id: "group-1",
      title: "Friday pool",
      createdAt: "2026-07-25T12:00:00.000Z"
    },
    state: status === "CONFIRMED" ? "PAID" : "READY_FOR_PAYMENT",
    fundingMode: "sponsored_demo",
    targetUnits: 3,
    claimedUnits: 3,
    participantCount: 3,
    createdAt: "2026-07-25T12:00:00.000Z",
    updatedAt: "2026-07-25T12:00:00.000Z",
    participants: [],
    paymentRequest: {
      id: "request-1",
      orderId: "order-1",
      checkoutId: "checkout-1",
      checkoutVersion: 1,
      checkoutHash: "checkout-hash",
      confirmationSetId: "confirmation-set-1",
      idempotencyKey: "stable-payment-key",
      payerRef: "sponsored-treasury",
      payeeId: "merchant-demo",
      money: { assetId: "USDC", amountAtomic: "285000000" },
      expiresAt: "2026-07-25T12:10:00.000Z",
      status: "ready",
      createdAt: "2026-07-25T12:00:00.000Z"
    },
    ...(status
      ? {
          paymentProjection: {
            paymentRequestId: "request-1",
            operationId: "operation-1",
            status,
            settlementMode:
              status === "DEMO_CONFIRMED"
                ? ("mock" as const)
                : ("testnet" as const),
            ...(status === "UNAVAILABLE"
              ? { errorCode: "PAYMENT_BASE_UNAVAILABLE" }
              : {}),
            ...(status === "FAILED" ? { errorCode: "PAYMENT_REJECTED" } : {}),
            ...(status === "CONFIRMED"
              ? {
                  receipt: {
                    kind: "chain" as const,
                    receiptId: "receipt-1",
                    transactionHash: "0xabc",
                    explorerUrl: "https://explorer.example/tx/0xabc",
                    confirmedAt: "2026-07-25T12:01:00.000Z"
                  }
                }
              : {}),
            attempts: 1,
            updatedAt: "2026-07-25T12:01:00.000Z"
          }
        }
      : {})
  };
}

test("payment status copy distinguishes every durable outcome", () => {
  const cases: Array<{
    status: PaymentProjectionStatus | undefined;
    expected: RegExp;
    forbidden?: RegExp;
  }> = [
    { status: undefined, expected: /Payment not ready/ },
    { status: "READY", expected: /No payment has been submitted/ },
    { status: "UNAVAILABLE", expected: /Payment base unavailable/ },
    { status: "SUBMITTING", expected: /Do not submit another payment/ },
    {
      status: "SUBMITTED",
      expected: /not a confirmed payment/,
      forbidden: /Merchant paid/
    },
    {
      status: "UNKNOWN",
      expected: /will not submit another payment/,
      forbidden: /Merchant paid/
    },
    {
      status: "FAILED",
      expected: /No successful payment receipt was recorded/,
      forbidden: /Merchant paid/
    },
    {
      status: "DEMO_CONFIRMED",
      expected: /No real funds moved/,
      forbidden: /Merchant paid/
    },
    {
      status: "CONFIRMED",
      expected: /Merchant paid with a verified settlement receipt/,
      forbidden: /Mock demo/
    }
  ];

  for (const value of cases) {
    const result = formatPaymentStatus(order(value.status));
    assert.match(result, value.expected);
    if (value.forbidden) assert.doesNotMatch(result, value.forbidden);
  }
});

test("confirmed status without verifiable receipt never claims the merchant was paid", () => {
  const malformed = order("CONFIRMED");
  malformed.paymentProjection = {
    ...malformed.paymentProjection!,
    settlementMode: "mock",
    receipt: undefined
  };

  const result = formatPaymentStatus(malformed);
  assert.match(result, /Payment evidence is incomplete/);
  assert.doesNotMatch(result, /Merchant paid/);
});
