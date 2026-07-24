import type {
  OrderDetailView,
  PaymentProjectionStatus,
  PoolMatePaymentRequest,
  SettlementMode
} from "@poolmate/shared";
import { DomainError } from "../domain/domainError.js";
import type {
  PaymentRequestRow,
  PaymentStateUpdate
} from "../infrastructure/db/orderRepository.js";
import { OrderRepository } from "../infrastructure/db/orderRepository.js";
import type {
  PaymentBaseClient,
  PaymentBaseOutcome
} from "./ports/paymentBaseClient.js";
import { OrderService } from "./orderService.js";

export interface PaymentOrchestrationServiceOptions {
  repository: OrderRepository;
  orderService: OrderService;
  paymentBaseClient?: PaymentBaseClient;
  now?: () => Date;
}

const PAYMENT_LEASE_MS = 30_000;

function paymentRequestView(row: PaymentRequestRow): PoolMatePaymentRequest {
  return {
    id: row.id,
    orderId: row.orderId,
    checkoutId: row.checkoutId,
    checkoutVersion: row.checkoutVersion,
    checkoutHash: row.checkoutHash,
    confirmationSetId: row.confirmationSetId,
    idempotencyKey: row.idempotencyKey,
    payerRef: row.payerRef,
    payeeId: row.payeeId,
    money: { assetId: row.assetId, amountAtomic: row.amountAtomic },
    expiresAt: row.expiresAt,
    status: row.status,
    createdAt: row.createdAt
  };
}

function validHttpsExplorer(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validConfirmedEvidence(
  outcome: Extract<PaymentBaseOutcome, { status: "confirmed" }>
): boolean {
  return (
    (outcome.settlementMode === "testnet" ||
      outcome.settlementMode === "live") &&
    Boolean(outcome.receiptId.trim()) &&
    Boolean(outcome.transactionHash.trim()) &&
    validHttpsExplorer(outcome.explorerUrl) &&
    Number.isFinite(new Date(outcome.confirmedAt).getTime())
  );
}

function errorDetails(error: unknown): {
  code: string;
  message: string;
} {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return {
      code: error.code,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : "The payment base request failed."
    };
  }
  return {
    code: "PAYMENT_OPERATION_UNKNOWN",
    message: "The payment base request failed."
  };
}

export class PaymentOrchestrationService {
  private readonly repository: OrderRepository;
  private readonly orderService: OrderService;
  private readonly paymentBaseClient?: PaymentBaseClient;
  private readonly now: () => Date;

  constructor(options: PaymentOrchestrationServiceOptions) {
    this.repository = options.repository;
    this.orderService = options.orderService;
    this.paymentBaseClient = options.paymentBaseClient;
    this.now = options.now ?? (() => new Date());
  }

  async submit(orderId: string): Promise<OrderDetailView> {
    const snapshot = this.paymentSnapshot(orderId);
    if (this.isTerminalOrInFlight(snapshot.projection.status)) {
      return this.orderService.getOrder(orderId);
    }
    if (
      !this.paymentBaseClient ||
      this.paymentBaseClient.settlementMode === "disabled"
    ) {
      this.markUnavailable(snapshot.request.id, "PAYMENT_BASE_UNAVAILABLE");
      throw new DomainError(
        "PAYMENT_BASE_UNAVAILABLE",
        "The payment base is not configured for submission.",
        503
      );
    }

    const claimTime = this.now();
    const claimed = this.repository.immediate((transaction) =>
      transaction.claimPaymentSubmission(
        snapshot.request.id,
        this.paymentBaseClient!.settlementMode,
        new Date(claimTime.getTime() + PAYMENT_LEASE_MS).toISOString(),
        claimTime.toISOString()
      )
    );
    if (claimed === "expired") {
      throw new DomainError(
        "CHECKOUT_EXPIRED",
        "The payment request has expired."
      );
    }
    if (claimed === "busy") return this.orderService.getOrder(orderId);

    let outcome: PaymentBaseOutcome;
    try {
      outcome = await this.paymentBaseClient.submit(
        paymentRequestView(snapshot.request)
      );
    } catch (error) {
      return this.applyThrownError(
        snapshot.request.id,
        snapshot.projection.operationId,
        error,
        false
      );
    }
    return this.applyOutcome(
      snapshot.request.id,
      snapshot.projection.operationId,
      outcome,
      false
    );
  }

  async recover(orderId: string): Promise<OrderDetailView> {
    const snapshot = this.paymentSnapshot(orderId);
    if (
      snapshot.projection.status !== "SUBMITTING" &&
      snapshot.projection.status !== "UNKNOWN" &&
      snapshot.projection.status !== "SUBMITTED"
    ) {
      throw new DomainError(
        "PAYMENT_RECOVERY_NOT_ALLOWED",
        "Only the original submitted or unknown operation can be recovered."
      );
    }
    const claimTime = this.now();
    const claimed = this.repository.immediate((transaction) =>
      transaction.claimPaymentRecovery(
        snapshot.request.id,
        new Date(claimTime.getTime() + PAYMENT_LEASE_MS).toISOString(),
        claimTime.toISOString()
      )
    );
    if (!claimed) return this.orderService.getOrder(orderId);
    const claimedSnapshot = this.paymentSnapshot(orderId);
    if (
      !this.paymentBaseClient ||
      this.paymentBaseClient.settlementMode === "disabled"
    ) {
      this.updateUnknown(
        snapshot.request.id,
        "PAYMENT_BASE_UNAVAILABLE",
        "The payment base is not configured for recovery.",
        claimedSnapshot.projection.settlementMode,
        snapshot.projection.operationId,
        ["UNKNOWN", "SUBMITTED"]
      );
      throw new DomainError(
        "PAYMENT_BASE_UNAVAILABLE",
        "The payment base is not configured for recovery.",
        503
      );
    }
    if (
      claimedSnapshot.projection.settlementMode === "disabled" ||
      claimedSnapshot.projection.settlementMode !==
        this.paymentBaseClient.settlementMode
    ) {
      this.updateUnknown(
        snapshot.request.id,
        "PAYMENT_RECOVERY_NOT_ALLOWED",
        "Recovery requires the original settlement mode.",
        claimedSnapshot.projection.settlementMode,
        snapshot.projection.operationId,
        ["UNKNOWN", "SUBMITTED"]
      );
      throw new DomainError(
        "PAYMENT_RECOVERY_NOT_ALLOWED",
        "Recovery requires the original settlement mode."
      );
    }
    let outcome: PaymentBaseOutcome;
    try {
      // Recovery is a read of the persisted operation, never a new submission.
      outcome = await this.paymentBaseClient.recover(
        snapshot.projection.operationId
      );
    } catch (error) {
      return this.applyThrownError(
        snapshot.request.id,
        snapshot.projection.operationId,
        error,
        true
      );
    }
    return this.applyOutcome(
      snapshot.request.id,
      snapshot.projection.operationId,
      outcome,
      true
    );
  }

  private paymentSnapshot(orderId: string) {
    return this.repository.read((transaction) => {
      const request = transaction.paymentRequest(orderId);
      if (!request) {
        throw new DomainError(
          "PAYMENT_RECOVERY_NOT_ALLOWED",
          "The order has no canonical payment request."
        );
      }
      const projection = transaction.paymentProjection(request.id);
      const outbox = transaction.paymentOutbox(request.id);
      if (!projection || !outbox) {
        throw new DomainError(
          "NOT_READY",
          "The payment workflow has not been initialized.",
          503
        );
      }
      return { request, projection, outbox };
    });
  }

  private isTerminalOrInFlight(status: PaymentProjectionStatus): boolean {
    return (
      status === "SUBMITTING" ||
      status === "SUBMITTED" ||
      status === "UNKNOWN" ||
      status === "FAILED" ||
      status === "CONFIRMED" ||
      status === "DEMO_CONFIRMED"
    );
  }

  private markUnavailable(paymentRequestId: string, code: string): void {
    const now = this.now().toISOString();
    this.repository.immediate((transaction) =>
      transaction.updatePaymentState(paymentRequestId, {
        requestStatus: "ready",
        projectionStatus: "UNAVAILABLE",
        settlementMode: this.paymentBaseClient?.settlementMode ?? "disabled",
        outboxStatus: "blocked",
        orderState: "READY_FOR_PAYMENT",
        errorCode: code,
        errorMessage: "The payment base is unavailable.",
        availableAt: now,
        now
      })
    );
  }

  private applyThrownError(
    paymentRequestId: string,
    operationId: string,
    error: unknown,
    recovery: boolean
  ): OrderDetailView {
    const allowedStatuses: PaymentProjectionStatus[] = recovery
      ? ["UNKNOWN", "SUBMITTED"]
      : ["SUBMITTING"];
    const details = errorDetails(error);
    if (details.code === "PAYMENT_BASE_UNAVAILABLE") {
      if (recovery) {
        return this.updateUnknown(
          paymentRequestId,
          "PAYMENT_BASE_UNAVAILABLE",
          details.message,
          undefined,
          operationId,
          allowedStatuses
        );
      }
      return this.updateUnknown(
        paymentRequestId,
        "PAYMENT_OPERATION_UNKNOWN",
        "The payment base became unavailable after submission began.",
        undefined,
        operationId,
        allowedStatuses
      );
    }
    if (details.code === "PAYMENT_APPROVAL_REQUIRED") {
      if (recovery) {
        return this.updateUnknown(
          paymentRequestId,
          "PAYMENT_APPROVAL_REQUIRED",
          details.message,
          undefined,
          operationId,
          allowedStatuses
        );
      }
      return this.updateReadyBlocked(
        paymentRequestId,
        "PAYMENT_APPROVAL_REQUIRED",
        details.message,
        undefined,
        operationId,
        allowedStatuses
      );
    }
    if (details.code === "PAYMENT_AMOUNT_UNSUPPORTED") {
      return this.updateFailed(
        paymentRequestId,
        "PAYMENT_AMOUNT_UNSUPPORTED",
        details.message,
        undefined,
        operationId,
        allowedStatuses
      );
    }
    return this.updateUnknown(
      paymentRequestId,
      "PAYMENT_OPERATION_UNKNOWN",
      "The payment result is uncertain and must be recovered by operation ID.",
      undefined,
      operationId,
      allowedStatuses
    );
  }

  private applyOutcome(
    paymentRequestId: string,
    expectedOperationId: string,
    outcome: PaymentBaseOutcome,
    recovery: boolean
  ): OrderDetailView {
    const allowedStatuses: PaymentProjectionStatus[] = recovery
      ? ["UNKNOWN", "SUBMITTED"]
      : ["SUBMITTING"];
    if (outcome.operationId !== expectedOperationId) {
      return this.updateUnknown(
        paymentRequestId,
        "PAYMENT_OPERATION_UNKNOWN",
        "The payment base returned a different operation ID.",
        undefined,
        expectedOperationId,
        allowedStatuses
      );
    }
    if (
      !this.paymentBaseClient ||
      outcome.settlementMode !== this.paymentBaseClient.settlementMode
    ) {
      return this.updateUnknown(
        paymentRequestId,
        "PAYMENT_OPERATION_UNKNOWN",
        "The payment result does not match the configured settlement mode.",
        this.paymentBaseClient?.settlementMode ?? "disabled",
        expectedOperationId,
        allowedStatuses
      );
    }
    if (outcome.status === "unknown") {
      return this.updateUnknown(
        paymentRequestId,
        outcome.errorCode ?? "PAYMENT_OPERATION_UNKNOWN",
        outcome.errorMessage ?? "The payment result is unknown.",
        undefined,
        expectedOperationId,
        allowedStatuses
      );
    }
    if (outcome.status === "submitted") {
      return this.updateState(
        paymentRequestId,
        {
          requestStatus: "submitted",
          projectionStatus: "SUBMITTED",
          settlementMode: outcome.settlementMode,
          outboxStatus: "completed",
          orderState: "PAYMENT_SUBMITTED",
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage
        },
        expectedOperationId,
        allowedStatuses
      );
    }
    if (outcome.status === "failed") {
      return this.updateFailed(
        paymentRequestId,
        outcome.errorCode ?? "PAYMENT_FAILED",
        outcome.errorMessage ?? "The payment operation failed.",
        outcome.settlementMode,
        expectedOperationId,
        allowedStatuses
      );
    }
    if (outcome.status === "approval_required") {
      if (recovery) {
        return this.updateUnknown(
          paymentRequestId,
          "PAYMENT_APPROVAL_REQUIRED",
          outcome.errorMessage ?? "The payment base requires approval.",
          undefined,
          expectedOperationId,
          allowedStatuses
        );
      }
      return this.updateReadyBlocked(
        paymentRequestId,
        "PAYMENT_APPROVAL_REQUIRED",
        outcome.errorMessage ?? "The payment base requires approval.",
        outcome.settlementMode,
        expectedOperationId,
        allowedStatuses
      );
    }

    const confirmed = outcome as Extract<
      PaymentBaseOutcome,
      { status: "confirmed" }
    >;
    if (confirmed.settlementMode === "mock") {
      if (
        !confirmed.receiptId.trim() ||
        !Number.isFinite(new Date(confirmed.confirmedAt).getTime())
      ) {
        return this.updateUnknown(
          paymentRequestId,
          "PAYMENT_OPERATION_UNKNOWN",
          "Mock confirmation evidence is incomplete.",
          "mock",
          expectedOperationId,
          allowedStatuses
        );
      }
      return this.updateState(
        paymentRequestId,
        {
          requestStatus: "demo_confirmed",
          projectionStatus: "DEMO_CONFIRMED",
          settlementMode: "mock",
          outboxStatus: "completed",
          orderState: "DEMO_CONFIRMED",
          receipt: {
            receiptId: confirmed.receiptId,
            transactionHash: confirmed.transactionHash,
            explorerUrl: confirmed.explorerUrl,
            confirmedAt: confirmed.confirmedAt
          }
        },
        expectedOperationId,
        allowedStatuses
      );
    }
    if (!validConfirmedEvidence(confirmed)) {
      return this.updateUnknown(
        paymentRequestId,
        "PAYMENT_OPERATION_UNKNOWN",
        "Confirmed settlement evidence is incomplete or not verifiable.",
        confirmed.settlementMode,
        expectedOperationId,
        allowedStatuses
      );
    }
    return this.updateState(
      paymentRequestId,
      {
        requestStatus: "confirmed",
        projectionStatus: "CONFIRMED",
        settlementMode: confirmed.settlementMode,
        outboxStatus: "completed",
        orderState: "PAID",
        receipt: {
          receiptId: confirmed.receiptId,
          transactionHash: confirmed.transactionHash,
          explorerUrl: confirmed.explorerUrl,
          confirmedAt: confirmed.confirmedAt
        }
      },
      expectedOperationId,
      allowedStatuses
    );
  }

  private updateReadyBlocked(
    paymentRequestId: string,
    errorCode: string,
    errorMessage: string,
    settlementMode?: SettlementMode,
    expectedOperationId?: string,
    allowedStatuses?: PaymentProjectionStatus[]
  ): OrderDetailView {
    return this.updateState(
      paymentRequestId,
      {
        requestStatus: "ready",
        projectionStatus: "UNAVAILABLE",
        settlementMode:
          settlementMode ??
          this.paymentBaseClient?.settlementMode ??
          "disabled",
        outboxStatus: "blocked",
        orderState: "READY_FOR_PAYMENT",
        errorCode,
        errorMessage
      },
      expectedOperationId,
      allowedStatuses
    );
  }

  private updateUnknown(
    paymentRequestId: string,
    errorCode: string,
    errorMessage: string,
    settlementMode?: SettlementMode,
    expectedOperationId?: string,
    allowedStatuses?: PaymentProjectionStatus[]
  ): OrderDetailView {
    return this.updateState(
      paymentRequestId,
      {
        requestStatus: "unknown",
        projectionStatus: "UNKNOWN",
        settlementMode:
          settlementMode ??
          this.paymentBaseClient?.settlementMode ??
          "disabled",
        outboxStatus: "unknown",
        orderState: "PAYMENT_UNKNOWN",
        errorCode,
        errorMessage
      },
      expectedOperationId,
      allowedStatuses
    );
  }

  private updateFailed(
    paymentRequestId: string,
    errorCode: string,
    errorMessage: string,
    settlementMode?: SettlementMode,
    expectedOperationId?: string,
    allowedStatuses?: PaymentProjectionStatus[]
  ): OrderDetailView {
    return this.updateState(
      paymentRequestId,
      {
        requestStatus: "failed",
        projectionStatus: "FAILED",
        settlementMode:
          settlementMode ??
          this.paymentBaseClient?.settlementMode ??
          "disabled",
        outboxStatus: "completed",
        orderState: "PAYMENT_FAILED",
        errorCode,
        errorMessage
      },
      expectedOperationId,
      allowedStatuses
    );
  }

  private updateState(
    paymentRequestId: string,
    update: Omit<PaymentStateUpdate, "availableAt" | "now">,
    expectedOperationId?: string,
    allowedStatuses?: PaymentProjectionStatus[]
  ): OrderDetailView {
    const now = this.now().toISOString();
    const orderId = this.repository.immediate((transaction) => {
      const request = transaction.paymentRequestById(paymentRequestId);
      if (!request) throw new Error("Payment request not found.");
      const stateUpdate = {
        ...update,
        availableAt: now,
        now
      };
      if (expectedOperationId && allowedStatuses) {
        transaction.updatePaymentStateIfCurrent(
          paymentRequestId,
          expectedOperationId,
          allowedStatuses,
          stateUpdate
        );
      } else {
        transaction.updatePaymentState(paymentRequestId, stateUpdate);
      }
      return request.orderId;
    });
    return this.orderService.getOrder(orderId);
  }
}
