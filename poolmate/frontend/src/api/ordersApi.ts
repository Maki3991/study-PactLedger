import type {
  AllocationConfirmationStatus,
  AllocationView,
  AtomicMoney,
  CheckoutHashView,
  CheckoutItemView,
  CheckoutView,
  ConfirmationResult,
  ConfirmationView,
  FundingMode,
  GroupView,
  MerchantView,
  OrderDetailView,
  OrderState,
  OrderSummaryView,
  ParticipantView,
  PaymentOutboxView,
  PaymentProjectionStatus,
  PaymentProjectionView,
  PoolMatePaymentRequest
} from "@poolmate/shared";
import {
  configuredApiBaseUrl,
  isIsoDate,
  isNonEmptyString,
  isNonNegativeInteger,
  isOneOf,
  isPositiveInteger,
  isRecord,
  requestJson
} from "./apiClient";

const orderStates: readonly OrderState[] = [
  "DRAFT",
  "COLLECTING",
  "QUOTE_PENDING",
  "CONFIRMATION_PENDING",
  "READY_FOR_PAYMENT",
  "PAYMENT_SUBMITTED",
  "PAID",
  "DEMO_CONFIRMED",
  "PAYMENT_FAILED",
  "PAYMENT_UNKNOWN"
];
const fundingModes: readonly FundingMode[] = [
  "sponsored_demo",
  "prefunded_participants"
];
const confirmationStatuses: readonly AllocationConfirmationStatus[] = [
  "pending",
  "confirmed",
  "declined",
  "superseded",
  "expired"
];
const paymentRequestStatuses = [
  "ready",
  "submitting",
  "submitted",
  "confirmed",
  "demo_confirmed",
  "failed",
  "unknown"
] as const;
const paymentProjectionStatuses: readonly PaymentProjectionStatus[] = [
  "READY",
  "UNAVAILABLE",
  "SUBMITTING",
  "SUBMITTED",
  "UNKNOWN",
  "FAILED",
  "CONFIRMED",
  "DEMO_CONFIRMED"
];
const settlementModes = ["disabled", "mock", "testnet", "live"] as const;
const outboxStatuses = [
  "pending",
  "processing",
  "completed",
  "blocked",
  "unknown"
] as const;

function isAtomicMoney(value: unknown): value is AtomicMoney {
  return (
    isRecord(value) &&
    isNonEmptyString(value.assetId) &&
    typeof value.amountAtomic === "string" &&
    /^\d+$/.test(value.amountAtomic)
  );
}

function isCheckoutItem(value: unknown): value is CheckoutItemView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sku) &&
    isNonEmptyString(value.name) &&
    typeof value.quantity === "string" &&
    /^[1-9]\d*$/.test(value.quantity) &&
    typeof value.unitAmountAtomic === "string" &&
    /^\d+$/.test(value.unitAmountAtomic)
  );
}

function isCheckoutHash(value: unknown): value is CheckoutHashView {
  return (
    isRecord(value) &&
    value.algorithm === "SHA-256" &&
    value.canonicalizationVersion === "poolmate-checkout-json-v1" &&
    isNonEmptyString(value.value)
  );
}

function sameAsset(monies: AtomicMoney[]): boolean {
  return monies.every((money) => money.assetId === monies[0]?.assetId);
}

function itemTotal(items: CheckoutItemView[]): bigint {
  return items.reduce(
    (sum, item) =>
      sum + BigInt(item.quantity) * BigInt(item.unitAmountAtomic),
    0n
  );
}

function breakdownBalances(
  items: CheckoutItemView[],
  goods: AtomicMoney,
  shipping: AtomicMoney,
  discount: AtomicMoney,
  fee: AtomicMoney,
  total: AtomicMoney
): boolean {
  return (
    sameAsset([goods, shipping, discount, fee, total]) &&
    itemTotal(items) === BigInt(goods.amountAtomic) &&
    BigInt(goods.amountAtomic) +
      BigInt(shipping.amountAtomic) +
      BigInt(fee.amountAtomic) -
      BigInt(discount.amountAtomic) ===
      BigInt(total.amountAtomic)
  );
}

function isGroupView(value: unknown): value is GroupView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isIsoDate(value.createdAt)
  );
}

function isParticipantView(value: unknown): value is ParticipantView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.displayName) &&
    isPositiveInteger(value.units) &&
    isIsoDate(value.joinedAt)
  );
}

function isMerchantView(value: unknown): value is MerchantView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.displayName) &&
    isNonEmptyString(value.payeeId) &&
    value.verified === true
  );
}

function isAllocationView(value: unknown): value is AllocationView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.participantId) &&
    isNonEmptyString(value.displayName) &&
    isPositiveInteger(value.units) &&
    isAtomicMoney(value.money) &&
    isOneOf(value.confirmationStatus, confirmationStatuses) &&
    (value.confirmedAt === undefined || isIsoDate(value.confirmedAt))
  );
}

function allocationsBalance(
  total: AtomicMoney,
  allocations: AllocationView[]
): boolean {
  return (
    allocations.every((item) => item.money.assetId === total.assetId) &&
    allocations.reduce(
      (sum, item) => sum + BigInt(item.money.amountAtomic),
      0n
    ) === BigInt(total.amountAtomic)
  );
}

function isCheckoutView(value: unknown): value is CheckoutView {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isPositiveInteger(value.version) ||
    !isCheckoutHash(value.hash) ||
    !isMerchantView(value.merchant) ||
    !Array.isArray(value.items) ||
    !value.items.every(isCheckoutItem) ||
    !isAtomicMoney(value.goods) ||
    !isAtomicMoney(value.shipping) ||
    !isAtomicMoney(value.discount) ||
    !isAtomicMoney(value.fee) ||
    !isAtomicMoney(value.total) ||
    !isIsoDate(value.expiresAt) ||
    !isIsoDate(value.createdAt) ||
    !Array.isArray(value.allocations) ||
    !value.allocations.every(isAllocationView)
  ) {
    return false;
  }
  return (
    breakdownBalances(
      value.items,
      value.goods,
      value.shipping,
      value.discount,
      value.fee,
      value.total
    ) && allocationsBalance(value.total, value.allocations)
  );
}

function isPaymentRequest(value: unknown): value is PoolMatePaymentRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.checkoutId) &&
    isPositiveInteger(value.checkoutVersion) &&
    isNonEmptyString(value.checkoutHash) &&
    isNonEmptyString(value.confirmationSetId) &&
    isNonEmptyString(value.idempotencyKey) &&
    isNonEmptyString(value.payerRef) &&
    isNonEmptyString(value.payeeId) &&
    isAtomicMoney(value.money) &&
    isIsoDate(value.expiresAt) &&
    isOneOf(value.status, paymentRequestStatuses) &&
    isIsoDate(value.createdAt)
  );
}

function isPaymentProjection(value: unknown): value is PaymentProjectionView {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.paymentRequestId) ||
    !isNonEmptyString(value.operationId) ||
    !isOneOf(value.status, paymentProjectionStatuses) ||
    !isOneOf(value.settlementMode, settlementModes) ||
    (value.errorCode !== undefined && !isNonEmptyString(value.errorCode)) ||
    (value.errorMessage !== undefined && !isNonEmptyString(value.errorMessage)) ||
    !isNonNegativeInteger(value.attempts) ||
    !isIsoDate(value.updatedAt)
  ) {
    return false;
  }
  if (value.receipt === undefined) {
    return value.status !== "CONFIRMED" && value.status !== "DEMO_CONFIRMED";
  }
  if (
    !isRecord(value.receipt) ||
    !isOneOf(value.receipt.kind, ["mock", "chain"] as const) ||
    !isNonEmptyString(value.receipt.receiptId) ||
    !isIsoDate(value.receipt.confirmedAt)
  ) {
    return false;
  }
  if (value.status === "DEMO_CONFIRMED") {
    return (
      value.settlementMode === "mock" &&
      value.receipt.kind === "mock" &&
      !("transactionHash" in value.receipt) &&
      !("explorerUrl" in value.receipt)
    );
  }
  return (
    value.receipt.kind === "chain" &&
    isNonEmptyString(value.receipt.transactionHash) &&
    isNonEmptyString(value.receipt.explorerUrl) &&
    value.receipt.explorerUrl.startsWith("https://") &&
    value.status === "CONFIRMED" &&
    (value.settlementMode === "testnet" || value.settlementMode === "live")
  );
}

function isPaymentOutbox(value: unknown): value is PaymentOutboxView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.paymentRequestId) &&
    isNonEmptyString(value.operationId) &&
    isOneOf(value.status, outboxStatuses) &&
    isNonNegativeInteger(value.attempts) &&
    (value.lastErrorCode === undefined ||
      isNonEmptyString(value.lastErrorCode)) &&
    isIsoDate(value.availableAt) &&
    isIsoDate(value.updatedAt)
  );
}

export function isOrderSummaryView(value: unknown): value is OrderSummaryView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isGroupView(value.group) &&
    isOneOf(value.state, orderStates) &&
    isOneOf(value.fundingMode, fundingModes) &&
    isPositiveInteger(value.targetUnits) &&
    isNonNegativeInteger(value.claimedUnits) &&
    value.claimedUnits <= value.targetUnits &&
    isNonNegativeInteger(value.participantCount) &&
    (value.checkoutVersion === undefined ||
      isPositiveInteger(value.checkoutVersion)) &&
    (value.expiresAt === undefined || isIsoDate(value.expiresAt)) &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt)
  );
}

function isOrderList(value: unknown): value is OrderSummaryView[] {
  return Array.isArray(value) && value.every(isOrderSummaryView);
}

export function isOrderDetailView(value: unknown): value is OrderDetailView {
  if (
    !isRecord(value) ||
    !isOrderSummaryView(value) ||
    !Array.isArray(value.participants) ||
    !value.participants.every(isParticipantView) ||
    (value.checkout !== undefined && !isCheckoutView(value.checkout)) ||
    (value.paymentRequest !== undefined &&
      !isPaymentRequest(value.paymentRequest)) ||
    (value.paymentProjection !== undefined &&
      !isPaymentProjection(value.paymentProjection)) ||
    (value.paymentOutbox !== undefined && !isPaymentOutbox(value.paymentOutbox))
  ) {
    return false;
  }
  const participantUnits = value.participants.reduce(
    (sum, participant) => sum + participant.units,
    0
  );
  if (
    value.participants.length !== value.participantCount ||
    participantUnits !== value.claimedUnits
  ) {
    return false;
  }
  if (value.checkout) {
    const participantIds = new Set(
      value.participants.map((participant) => participant.id)
    );
    if (
      value.checkoutVersion !== value.checkout.version ||
      value.checkout.allocations.length !== value.participants.length ||
      value.checkout.allocations.some(
        (allocation) => !participantIds.has(allocation.participantId)
      )
    ) {
      return false;
    }
  }
  if (value.paymentRequest) {
    const checkout = value.checkout;
    if (
      !checkout ||
      value.paymentRequest.orderId !== value.id ||
      value.paymentRequest.checkoutId !== checkout.id ||
      value.paymentRequest.checkoutVersion !== checkout.version ||
      value.paymentRequest.checkoutHash !== checkout.hash.value ||
      value.paymentRequest.payeeId !== checkout.merchant.payeeId ||
      value.paymentRequest.money.assetId !== checkout.total.assetId ||
      value.paymentRequest.money.amountAtomic !== checkout.total.amountAtomic
    ) {
      return false;
    }
    if (
      !value.paymentProjection ||
      !value.paymentOutbox ||
      value.paymentProjection.paymentRequestId !== value.paymentRequest.id ||
      value.paymentOutbox.paymentRequestId !== value.paymentRequest.id ||
      value.paymentProjection.operationId !== value.paymentOutbox.operationId
    ) {
      return false;
    }
  } else if (value.paymentProjection || value.paymentOutbox) {
    return false;
  }
  if (
    value.state === "PAID" &&
    (value.paymentProjection?.status !== "CONFIRMED" ||
      !value.paymentProjection.receipt)
  ) {
    return false;
  }
  return true;
}

export function isConfirmationView(value: unknown): value is ConfirmationView {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.orderId) ||
    !isNonEmptyString(value.orderTitle) ||
    !isNonEmptyString(value.participantDisplayName) ||
    !isPositiveInteger(value.checkoutVersion) ||
    !isCheckoutHash(value.checkoutHash) ||
    !isMerchantView(value.merchant) ||
    !Array.isArray(value.items) ||
    !value.items.every(isCheckoutItem) ||
    !isPositiveInteger(value.participantUnits) ||
    !isAtomicMoney(value.goods) ||
    !isAtomicMoney(value.shipping) ||
    !isAtomicMoney(value.discount) ||
    !isAtomicMoney(value.fee) ||
    !isAtomicMoney(value.orderTotal) ||
    !isAtomicMoney(value.money) ||
    !isIsoDate(value.expiresAt) ||
    !isOneOf(value.status, confirmationStatuses) ||
    (value.confirmedAt !== undefined && !isIsoDate(value.confirmedAt))
  ) {
    return false;
  }
  return (
    sameAsset([
      value.goods,
      value.shipping,
      value.discount,
      value.fee,
      value.orderTotal,
      value.money
    ]) &&
    breakdownBalances(
      value.items,
      value.goods,
      value.shipping,
      value.discount,
      value.fee,
      value.orderTotal
    ) &&
    (value.status !== "confirmed" || value.confirmedAt !== undefined)
  );
}

export function isConfirmationResult(
  value: unknown
): value is ConfirmationResult {
  return (
    isRecord(value) &&
    isConfirmationView(value.confirmation) &&
    (value.confirmation.status === "confirmed" ||
      value.confirmation.status === "declined") &&
    isOneOf(value.orderState, orderStates) &&
    typeof value.paymentRequestCreated === "boolean"
  );
}

export interface OrdersApi {
  listOrders(
    adminApiKey: string,
    signal?: AbortSignal
  ): Promise<OrderSummaryView[]>;
  getOrder(
    id: string,
    adminApiKey: string,
    signal?: AbortSignal
  ): Promise<OrderDetailView>;
  submitPayment(
    id: string,
    adminApiKey: string,
    signal?: AbortSignal
  ): Promise<OrderDetailView>;
  recoverPayment(
    id: string,
    adminApiKey: string,
    signal?: AbortSignal
  ): Promise<OrderDetailView>;
  getConfirmation(
    token: string,
    signal?: AbortSignal
  ): Promise<ConfirmationView>;
  confirm(
    token: string,
    telegramInitData: string,
    signal?: AbortSignal
  ): Promise<ConfirmationResult>;
  decline(
    token: string,
    telegramInitData: string,
    signal?: AbortSignal
  ): Promise<ConfirmationResult>;
}

export function createOrdersApi(
  baseUrl = configuredApiBaseUrl()
): OrdersApi {
  return {
    listOrders: (adminApiKey, signal) =>
      requestJson(baseUrl, "/api/orders", isOrderList, {
        signal,
        headers: { Authorization: `Bearer ${adminApiKey}` }
      }),
    getOrder: (id, adminApiKey, signal) =>
      requestJson(
        baseUrl,
        `/api/orders/${encodeURIComponent(id)}`,
        isOrderDetailView,
        {
          signal,
          headers: { Authorization: `Bearer ${adminApiKey}` }
        }
      ),
    submitPayment: (id, adminApiKey, signal) =>
      requestJson(
        baseUrl,
        `/api/orders/${encodeURIComponent(id)}/payment/submit`,
        isOrderDetailView,
        {
          signal,
          method: "POST",
          body: {},
          headers: { Authorization: `Bearer ${adminApiKey}` }
        }
      ),
    recoverPayment: (id, adminApiKey, signal) =>
      requestJson(
        baseUrl,
        `/api/orders/${encodeURIComponent(id)}/payment/recover`,
        isOrderDetailView,
        {
          signal,
          method: "POST",
          body: {},
          headers: { Authorization: `Bearer ${adminApiKey}` }
        }
      ),
    getConfirmation: (token, signal) =>
      requestJson(
        baseUrl,
        "/api/public/confirmation",
        isConfirmationView,
        {
          signal,
          headers: { "X-PoolMate-Confirmation-Token": token }
        }
      ),
    confirm: (token, telegramInitData, signal) =>
      requestJson(
        baseUrl,
        "/api/public/confirmation/confirm",
        isConfirmationResult,
        {
          signal,
          method: "POST",
          body: {},
          headers: {
            Authorization: `tma ${telegramInitData}`,
            "X-PoolMate-Confirmation-Token": token
          }
        }
      ),
    decline: (token, telegramInitData, signal) =>
      requestJson(
        baseUrl,
        "/api/public/confirmation/decline",
        isConfirmationResult,
        {
          signal,
          method: "POST",
          body: {},
          headers: {
            Authorization: `tma ${telegramInitData}`,
            "X-PoolMate-Confirmation-Token": token
          }
        }
      )
  };
}
