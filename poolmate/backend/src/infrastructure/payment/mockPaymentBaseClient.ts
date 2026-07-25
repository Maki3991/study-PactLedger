import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { PoolMatePaymentRequest } from "@poolmate/shared";
import type {
  PaymentBaseClient,
  PaymentBaseOutcome
} from "../../application/ports/paymentBaseClient.js";
import type { PoolMateDatabase } from "../db/database.js";

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
  operation_id: string;
  payment_request_id: string;
  idempotency_key: string;
  request_hash: string;
  request_json: string;
  state: "POLICY_REJECTED" | "DEMO_CONFIRMED";
  policy_code: string;
  policy_reason: string;
  receipt_id: string | null;
  confirmed_at: string | null;
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
  connection: Database.Database,
  operationId: string
): MockOperationRow | undefined {
  return connection
    .prepare(
      `SELECT o.*, d.code AS policy_code, d.reason AS policy_reason,
              r.id AS receipt_id, r.confirmed_at
       FROM pm_mock_payment_operations o
       JOIN pm_mock_policy_decisions d ON d.operation_id = o.operation_id
       LEFT JOIN pm_mock_settlement_receipts r ON r.operation_id = o.operation_id
       WHERE o.operation_id = ?`
    )
    .get(operationId) as MockOperationRow | undefined;
}

function asOutcome(row: MockOperationRow): PaymentBaseOutcome {
  if (row.state === "POLICY_REJECTED") {
    return {
      status: "failed",
      operationId: row.operation_id,
      settlementMode: "mock",
      errorCode: row.policy_code,
      errorMessage: row.policy_reason
    };
  }
  if (!row.receipt_id || !row.confirmed_at) {
    return {
      status: "unknown",
      operationId: row.operation_id,
      settlementMode: "mock",
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      errorMessage: "Persisted Mock receipt evidence is incomplete."
    };
  }
  return {
    status: "confirmed",
    operationId: row.operation_id,
    settlementMode: "mock",
    receiptId: row.receipt_id,
    transactionHash: "",
    explorerUrl: "",
    confirmedAt: row.confirmed_at
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

    return this.database.immediate((connection) => {
      const existing = loadOperation(connection, operationId);
      if (existing) {
        if (
          existing.payment_request_id !== request.id ||
          existing.idempotency_key !== request.idempotencyKey ||
          existing.request_hash !== requestHash ||
          existing.request_json !== requestJson
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
        .prepare(
          `INSERT INTO pm_mock_payment_operations
           (operation_id, payment_request_id, idempotency_key, request_hash,
            request_json, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          operationId,
          request.id,
          request.idempotencyKey,
          requestHash,
          requestJson,
          approved ? "DEMO_CONFIRMED" : "POLICY_REJECTED",
          evaluatedAt
        );
      connection
        .prepare(
          `INSERT INTO pm_mock_policy_decisions
           (id, operation_id, outcome, code, reason, checks_json, evaluated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `pmpd_${digest(`decision:${operationId}`).slice(0, 32)}`,
          operationId,
          decision.outcome,
          decision.code,
          decision.reason,
          JSON.stringify(decision.checks),
          evaluatedAt
        );
      if (approved) {
        connection
          .prepare(
            `INSERT INTO pm_mock_settlement_receipts
             (id, operation_id, status, transaction_hash, explorer_url,
              confirmed_at, created_at)
             VALUES (?, ?, 'DEMO_CONFIRMED', '', '', ?, ?)`
          )
          .run(
            `pmrc_mock_${digest(`receipt:${operationId}`).slice(0, 32)}`,
            operationId,
            evaluatedAt,
            evaluatedAt
          );
      }
      return asOutcome(loadOperation(connection, operationId)!);
    });
  }

  async recover(operationId: string): Promise<PaymentBaseOutcome> {
    const existing = this.database.read((connection) =>
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
