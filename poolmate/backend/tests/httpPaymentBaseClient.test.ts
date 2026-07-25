import assert from "node:assert/strict";
import test from "node:test";
import type { PoolMatePaymentRequest } from "@poolmate/shared";
import {
  createHttpPaymentBaseClient,
  PaymentBaseClientError,
  type PaymentBaseHttpTransport,
  type PaymentBaseHttpTransportRequest,
  type PaymentBaseHttpTransportResponse
} from "../src/infrastructure/payment/httpPaymentBaseClient.js";

const REQUEST: PoolMatePaymentRequest = {
  id: "request-1",
  orderId: "order-1",
  checkoutId: "checkout-1",
  checkoutVersion: 1,
  checkoutHash: "sha256-checkout",
  confirmationSetId: "confirmation-set-1",
  idempotencyKey: "stable-payment-key",
  payerRef: "sponsored-treasury",
  payeeId: "merchant-demo",
  money: { assetId: "USDC", amountAtomic: "285000000" },
  expiresAt: "2026-07-25T12:10:00.000Z",
  status: "ready",
  createdAt: "2026-07-25T12:00:00.000Z"
};

class RecordingTransport implements PaymentBaseHttpTransport {
  readonly requests: PaymentBaseHttpTransportRequest[] = [];

  constructor(
    private readonly response:
      | PaymentBaseHttpTransportResponse
      | ((
          request: PaymentBaseHttpTransportRequest
        ) => Promise<PaymentBaseHttpTransportResponse>)
  ) {}

  async send(
    request: PaymentBaseHttpTransportRequest
  ): Promise<PaymentBaseHttpTransportResponse> {
    this.requests.push(request);
    return typeof this.response === "function"
      ? this.response(request)
      : this.response;
  }
}

function enabledClient(transport: PaymentBaseHttpTransport, timeoutMs = 1_000) {
  return createHttpPaymentBaseClient({
    url: "https://payments.example.test",
    apiKey: "server-secret",
    settlementMode: "testnet",
    endpointPaths: {
      submit: "/v1/payment-operations",
      recover: "/v1/payment-operations/{operationId}"
    },
    timeoutMs,
    transport
  });
}

function assertClientError(
  error: unknown,
  code: PaymentBaseClientError["code"]
): boolean {
  return error instanceof PaymentBaseClientError && error.code === code;
}

test("client remains disabled until the unpublished remote contract is explicitly configured", async () => {
  const client = createHttpPaymentBaseClient({
    url: "https://payments.example.test",
    apiKey: "server-secret",
    settlementMode: "testnet"
  });

  assert.equal(client.settlementMode, "disabled");
  await assert.rejects(client.submit(REQUEST, "operation-1"), (error) =>
    assertClientError(error, "PAYMENT_BASE_UNAVAILABLE")
  );
});

test("submission sends only the operation identity and canonical payment request with server authentication", async () => {
  const transport = new RecordingTransport({
    status: 200,
    body: JSON.stringify({
      status: "submitted",
      operationId: "operation-1",
      settlementMode: "testnet"
    })
  });
  const client = enabledClient(transport);
  const input = { ...REQUEST, ignoredByCanonicalMapper: "not-sent" };

  const outcome = await client.submit(input, "operation-1");

  assert.equal(outcome.status, "submitted");
  assert.equal(transport.requests.length, 1);
  const sent = transport.requests[0]!;
  assert.equal(sent.method, "POST");
  assert.equal(
    sent.url.toString(),
    "https://payments.example.test/v1/payment-operations"
  );
  assert.equal(sent.headers.authorization, "Bearer server-secret");
  assert.equal(sent.headers["idempotency-key"], "stable-payment-key");
  assert.deepEqual(JSON.parse(sent.body!), {
    operationId: "operation-1",
    request: REQUEST
  });
  assert.equal(sent.body?.includes("ignoredByCanonicalMapper"), false);
});

test("recovery performs one read for the original encoded operation ID and sends no body", async () => {
  const transport = new RecordingTransport({
    status: 200,
    body: JSON.stringify({
      status: "unknown",
      operationId: "operation/one",
      settlementMode: "testnet",
      errorCode: "PAYMENT_OPERATION_UNKNOWN"
    })
  });
  const client = enabledClient(transport);

  await client.recover("operation/one");

  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0]!.method, "GET");
  assert.equal(
    transport.requests[0]!.url.toString(),
    "https://payments.example.test/v1/payment-operations/operation%2Fone"
  );
  assert.equal(transport.requests[0]!.body, undefined);
  assert.equal(transport.requests[0]!.headers["idempotency-key"], undefined);
});

test("submission rejects an invalid persisted operation identity before transport", async () => {
  const transport = new RecordingTransport({ status: 500, body: "{}" });
  const client = enabledClient(transport);

  await assert.rejects(client.submit(REQUEST, "operation\ninvalid"), (error) =>
    assertClientError(error, "PAYMENT_RECOVERY_NOT_ALLOWED")
  );
  assert.equal(transport.requests.length, 0);
});

test("client rejects insecure, demo, and traversal endpoint configuration", () => {
  const cases = [
    {
      url: "http://payments.example.test",
      submit: "/v1/payment-operations"
    },
    {
      url: "https://payments.example.test",
      submit: "/api/demo/poolmate/checkout"
    },
    {
      url: "https://payments.example.test",
      submit: "/api/%2e%2e/demo/checkout"
    },
    {
      url: "https://payments.example.test/untrusted-base-path",
      submit: "/v1/payment-operations"
    }
  ];
  for (const value of cases) {
    assert.throws(
      () =>
        createHttpPaymentBaseClient({
          url: value.url,
          apiKey: "server-secret",
          settlementMode: "testnet",
          endpointPaths: {
            submit: value.submit,
            recover: "/v1/payment-operations/{operationId}"
          }
        }),
      (error) => assertClientError(error, "PAYMENT_BASE_UNAVAILABLE")
    );
  }
});

test("authentication and stable policy errors are normalized without leaking remote details", async () => {
  const cases: Array<{
    response: PaymentBaseHttpTransportResponse;
    code: PaymentBaseClientError["code"];
  }> = [
    {
      response: { status: 401, body: "secret upstream response" },
      code: "PAYMENT_BASE_UNAVAILABLE"
    },
    {
      response: {
        status: 409,
        body: JSON.stringify({
          error: {
            code: "PAYMENT_APPROVAL_REQUIRED",
            message: "A human approver is required."
          }
        })
      },
      code: "PAYMENT_APPROVAL_REQUIRED"
    },
    {
      response: {
        status: 422,
        body: JSON.stringify({
          error: {
            code: "PAYMENT_AMOUNT_UNSUPPORTED",
            message: "Atomic amount cannot be represented."
          }
        })
      },
      code: "PAYMENT_AMOUNT_UNSUPPORTED"
    },
    {
      response: {
        status: 400,
        body: JSON.stringify({
          error: { code: "REMOTE_PRIVATE_CODE", message: "internal detail" }
        })
      },
      code: "PAYMENT_OPERATION_UNKNOWN"
    }
  ];

  for (const value of cases) {
    const client = enabledClient(new RecordingTransport(value.response));
    await assert.rejects(client.submit(REQUEST, "operation-1"), (error) =>
      assertClientError(error, value.code)
    );
  }
});

test("transport timeout and invalid successful payload fail closed as unknown", async () => {
  const hanging = new RecordingTransport(
    async () => new Promise<PaymentBaseHttpTransportResponse>(() => undefined)
  );
  const timedClient = enabledClient(hanging, 5);
  await assert.rejects(timedClient.submit(REQUEST, "operation-1"), (error) =>
    assertClientError(error, "PAYMENT_OPERATION_UNKNOWN")
  );

  const invalidClient = enabledClient(
    new RecordingTransport({
      status: 200,
      body: JSON.stringify({
        status: "confirmed",
        operationId: "operation-1",
        settlementMode: "testnet",
        receiptId: "receipt-1"
      })
    })
  );
  await assert.rejects(invalidClient.submit(REQUEST, "operation-1"), (error) =>
    assertClientError(error, "PAYMENT_OPERATION_UNKNOWN")
  );
});

test("client rejects results from a different settlement mode", async () => {
  const client = enabledClient(
    new RecordingTransport({
      status: 200,
      body: JSON.stringify({
        status: "submitted",
        operationId: "operation-1",
        settlementMode: "mock"
      })
    })
  );

  await assert.rejects(client.submit(REQUEST, "operation-1"), (error) =>
    assertClientError(error, "PAYMENT_OPERATION_UNKNOWN")
  );
});

test("successful error outcomes are normalized to local stable details", async () => {
  const client = enabledClient(
    new RecordingTransport({
      status: 200,
      body: JSON.stringify({
        status: "unknown",
        operationId: "operation-1",
        settlementMode: "testnet",
        errorCode: "REMOTE_PRIVATE_CODE",
        errorMessage: "remote internal detail"
      })
    })
  );

  assert.deepEqual(await client.submit(REQUEST, "operation-1"), {
    status: "unknown",
    operationId: "operation-1",
    settlementMode: "testnet",
    errorCode: "PAYMENT_OPERATION_UNKNOWN",
    errorMessage: "The payment result is unknown."
  });
});
