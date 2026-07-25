import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PoolMatePaymentRequest } from "@poolmate/shared";
import type {
  PaymentBaseClient,
  PaymentBaseOutcome
} from "../../application/ports/paymentBaseClient.js";
import type { PoolMateDatabase } from "../db/database.js";
import {
  mockPaymentOperations,
  mockPolicyDecisions,
  mockSettlementReceipts
} from "../db/schema.js";

interface MockPolicyCheck {
  code: string;
  passed: boolean;
}

interface MockPolicyDecision {
  outcome: "approved" | "rejected";
  code: string;
  reason: string;
  checks: MockPolicyCheck[];
}

interface MockOperationRow {
  operationId: string;
  paymentRequestId: string;
  idempotencyKey: string;
  requestHash: string;
  requestJson: string;
  state: "POLICY_REJECTED" | "DEMO_CONFIRMED";
  policyCode: string;
  policyReason: string;
  receiptId: string | null;
  confirmedAt: string | null;
}

export interface MockPaymentBaseClientOptions {
  database: PoolMateDatabase;
  allowedPayeeIds: readonly string[];
  supportedAssetIds: readonly string[];
  now?: () => Date;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalRequest(request: PoolMatePaymentRequest): string {
  return JSON.stringify({
    id: request.id,
    orderId: request.orderId,
    checkoutId: request.checkoutId,
    checkoutVersion: request.checkoutVersion,
    checkoutHash: request.checkoutHash,
    confirmationSetId: request.confirmationSetId,
    idempotencyKey: request.idempotencyKey,
    payerRef: request.payerRef,
    payeeId: request.payeeId,
    money: {
      assetId: request.money.assetId,
      amountAtomic: request.money.amountAtomic
    },
    expiresAt: request.expiresAt,
    status: request.status,
    createdAt: request.createdAt
  });
}

function loadOperation(
  connection: PoolMateDatabase["orm"],
  operationId: string
): MockOperationRow | undefined {
  const row = connection
    .select({
      operation: mockPaymentOperations,
      decision: mockPolicyDecisions,
      receipt: mockSettlementReceipts
    })
    .from(mockPaymentOperations)
    .innerJoin(
      mockPolicyDecisions,
      eq(mockPolicyDecisions.operationId, mockPaymentOperations.operationId)
    )
    .leftJoin(
      mockSettlementReceipts,
      eq(mockSettlementReceipts.operationId, mockPaymentOperations.operationId)
    )
    .where(eq(mockPaymentOperations.operationId, operationId))
    .get();
  if (!row) return undefined;
  return {
    operationId: row.operation.operationId,
    paymentRequestId: row.operation.paymentRequestId,
    idempotencyKey: row.operation.idempotencyKey,
    requestHash: row.operation.requestHash,
    requestJson: row.operation.requestJson,
    state: row.operation.state as MockOperationRow["state"],
    policyCode: row.decision.code,
    policyReason: row.decision.reason,
    receiptId: row.receipt?.id ?? null,
    confirmedAt: row.receipt?.confirmedAt ?? null
  };
}

function asOutcome(row: MockOperationRow): PaymentBaseOutcome {
  if (row.state === "POLICY_REJECTED") {
    return {
      status: "failed",
      operationId: row.operationId,
      settlementMode: "mock",
      errorCode: row.policyCode,
      errorMessage: row.policyReason
    };
  }
  if (!row.receiptId || !row.confirmedAt) {
    return {
      status: "unknown",
      operationId: row.operationId,
      settlementMode: "mock",
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      errorMessage: "Persisted Mock receipt evidence is incomplete."
    };
  }
  return {
    status: "confirmed",
    operationId: row.operationId,
    settlementMode: "mock",
    receiptId: row.receiptId,
    transactionHash: "",
    explorerUrl: "",
    confirmedAt: row.confirmedAt
  };
}

export class MockPaymentBaseClient implements PaymentBaseClient {
  readonly settlementMode = "mock" as const;
  private readonly database: PoolMateDatabase;
  private readonly allowedPayeeIds: ReadonlySet<string>;
  private readonly supportedAssetIds: ReadonlySet<string>;
  private readonly now: () => Date;

  constructor(options: MockPaymentBaseClientOptions) {
    this.database = options.database;
    this.allowedPayeeIds = new Set(options.allowedPayeeIds);
    this.supportedAssetIds = new Set(options.supportedAssetIds);
    this.now = options.now ?? (() => new Date());
  }

  async submit(
    request: PoolMatePaymentRequest,
    operationId: string
  ): Promise<PaymentBaseOutcome> {
    if (operationId !== `pmop_${request.idempotencyKey}`) {
      return {
        status: "failed",
        operationId,
        settlementMode: "mock",
        errorCode: "PAYMENT_OPERATION_CONFLICT",
        errorMessage:
          "The operation ID does not match the payment idempotency identity."
      };
    }
    const requestJson = canonicalRequest(request);
    const requestHash = digest(requestJson);
    const evaluatedAt = this.now().toISOString();
    const decision = this.evaluate(request, operationId, evaluatedAt);

    return this.database.ormImmediate((connection) => {
      const existing = loadOperation(connection, operationId);
      if (existing) {
        if (
          existing.paymentRequestId !== request.id ||
          existing.idempotencyKey !== request.idempotencyKey ||
          existing.requestHash !== requestHash ||
          existing.requestJson !== requestJson
        ) {
          return {
            status: "failed",
            operationId,
            settlementMode: "mock",
            errorCode: "PAYMENT_OPERATION_CONFLICT",
            errorMessage:
              "The Mock operation ID is already bound to a different payment intent."
          };
        }
        return asOutcome(existing);
      }

      const approved = decision.outcome === "approved";
      connection
        .insert(mockPaymentOperations)
        .values({
          operationId,
          paymentRequestId: request.id,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          requestJson,
          state: approved ? "DEMO_CONFIRMED" : "POLICY_REJECTED",
          createdAt: evaluatedAt
        })
        .run();
      connection
        .insert(mockPolicyDecisions)
        .values({
          id: `pmpd_${digest(`decision:${operationId}`).slice(0, 32)}`,
          operationId,
          outcome: decision.outcome,
          code: decision.code,
          reason: decision.reason,
          checksJson: JSON.stringify(decision.checks),
          evaluatedAt
        })
        .run();
      if (approved) {
        connection
          .insert(mockSettlementReceipts)
          .values({
            id: `pmrc_mock_${digest(`receipt:${operationId}`).slice(0, 32)}`,
            operationId,
            status: "DEMO_CONFIRMED",
            transactionHash: "",
            explorerUrl: "",
            confirmedAt: evaluatedAt,
            createdAt: evaluatedAt
          })
          .run();
      }
      return asOutcome(loadOperation(connection, operationId)!);
    });
  }

  async recover(operationId: string): Promise<PaymentBaseOutcome> {
    const existing = this.database.ormRead((connection) =>
      loadOperation(connection, operationId)
    );
    return existing
      ? asOutcome(existing)
      : {
          status: "unknown",
          operationId,
          settlementMode: "mock",
          errorCode: "PAYMENT_OPERATION_UNKNOWN",
          errorMessage: "The Mock operation was not found."
        };
  }

  private evaluate(
    request: PoolMatePaymentRequest,
    operationId: string,
    evaluatedAt: string
  ): MockPolicyDecision {
    const expiresAt = new Date(request.expiresAt).getTime();
    const checks: MockPolicyCheck[] = [
      {
        code: "MOCK_PAYEE_ALLOWED",
        passed: this.allowedPayeeIds.has(request.payeeId)
      },
      {
        code: "MOCK_ASSET_SUPPORTED",
        passed: this.supportedAssetIds.has(request.money.assetId)
      },
      {
        code: "MOCK_AMOUNT_POSITIVE",
        passed: /^[1-9][0-9]*$/.test(request.money.amountAtomic)
      },
      {
        code: "MOCK_REQUEST_NOT_EXPIRED",
        passed:
          Number.isFinite(expiresAt) &&
          expiresAt > new Date(evaluatedAt).getTime()
      },
      {
        code: "MOCK_REQUEST_READY",
        passed: request.status === "ready"
      }
    ];
    const rejected = checks.find((check) => !check.passed);
    if (!rejected) {
      return {
        outcome: "approved",
        code: "MOCK_POLICY_APPROVED",
        reason: "Mock payment policy approved the intent.",
        checks
      };
    }
    const rejections: Record<string, { code: string; reason: string }> = {
      MOCK_PAYEE_ALLOWED: {
        code: "PAYMENT_PAYEE_NOT_ALLOWED",
        reason: "The payee is not allowed by Mock payment policy."
      },
      MOCK_ASSET_SUPPORTED: {
        code: "PAYMENT_ASSET_UNSUPPORTED",
        reason: "The asset is not supported by Mock payment policy."
      },
      MOCK_AMOUNT_POSITIVE: {
        code: "PAYMENT_AMOUNT_UNSUPPORTED",
        reason: "The atomic payment amount must be a positive integer."
      },
      MOCK_REQUEST_NOT_EXPIRED: {
        code: "PAYMENT_REQUEST_EXPIRED",
        reason: "The payment intent has expired."
      },
      MOCK_REQUEST_READY: {
        code: "PAYMENT_REQUEST_NOT_READY",
        reason: "The payment intent is not ready for submission."
      }
    };
    const rejection = rejections[rejected.code]!;
    return {
      outcome: "rejected",
      code: rejection.code,
      reason: rejection.reason,
      checks
    };
  }
}
