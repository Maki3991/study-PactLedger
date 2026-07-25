export type FundingMode = "sponsored_demo" | "prefunded_participants";

export type OrderState =
  | "DRAFT"
  | "COLLECTING"
  | "QUOTE_PENDING"
  | "CONFIRMATION_PENDING"
  | "READY_FOR_PAYMENT"
  | "PAYMENT_SUBMITTED"
  | "PAID"
  | "DEMO_CONFIRMED"
  | "PAYMENT_FAILED"
  | "PAYMENT_UNKNOWN";

export interface AtomicMoney {
  assetId: string;
  amountAtomic: string;
}

export interface CheckoutItemView {
  sku: string;
  name: string;
  quantity: string;
  unitAmountAtomic: string;
}

export interface CheckoutHashView {
  algorithm: "SHA-256";
  canonicalizationVersion: "poolmate-checkout-json-v1";
  value: string;
}

export interface GroupView {
  id: string;
  title: string;
  createdAt: string;
}

export interface ParticipantView {
  id: string;
  displayName: string;
  units: number;
  joinedAt: string;
}

export interface MerchantView {
  id: string;
  displayName: string;
  payeeId: string;
  verified: true;
}

export type AllocationConfirmationStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "superseded"
  | "expired";

export interface AllocationView {
  participantId: string;
  displayName: string;
  units: number;
  money: AtomicMoney;
  confirmationStatus: AllocationConfirmationStatus;
  confirmedAt?: string;
}

export interface CheckoutView {
  id: string;
  version: number;
  hash: CheckoutHashView;
  merchant: MerchantView;
  items: CheckoutItemView[];
  goods: AtomicMoney;
  shipping: AtomicMoney;
  discount: AtomicMoney;
  fee: AtomicMoney;
  total: AtomicMoney;
  expiresAt: string;
  createdAt: string;
  allocations: AllocationView[];
}

export interface PoolMatePaymentRequest {
  id: string;
  orderId: string;
  checkoutId: string;
  checkoutVersion: number;
  checkoutHash: string;
  confirmationSetId: string;
  idempotencyKey: string;
  payerRef: string;
  payeeId: string;
  money: AtomicMoney;
  expiresAt: string;
  status:
    | "ready"
    | "submitting"
    | "submitted"
    | "confirmed"
    | "demo_confirmed"
    | "failed"
    | "unknown";
  createdAt: string;
}

export type PaymentProjectionStatus =
  | "READY"
  | "UNAVAILABLE"
  | "SUBMITTING"
  | "SUBMITTED"
  | "UNKNOWN"
  | "FAILED"
  | "CONFIRMED"
  | "DEMO_CONFIRMED";

export type PaymentReceiptView =
  | {
      kind: "mock";
      receiptId: string;
      confirmedAt: string;
    }
  | {
      kind: "chain";
      receiptId: string;
      transactionHash: string;
      explorerUrl: string;
      confirmedAt: string;
    };

export interface PaymentProjectionView {
  paymentRequestId: string;
  operationId: string;
  status: PaymentProjectionStatus;
  settlementMode: "disabled" | "mock" | "testnet" | "live";
  errorCode?: string;
  errorMessage?: string;
  receipt?: PaymentReceiptView;
  attempts: number;
  updatedAt: string;
}

export interface PaymentOutboxView {
  id: string;
  paymentRequestId: string;
  operationId: string;
  status: "pending" | "processing" | "completed" | "blocked" | "unknown";
  attempts: number;
  lastErrorCode?: string;
  availableAt: string;
  updatedAt: string;
}

export interface OrderSummaryView {
  id: string;
  title: string;
  group: GroupView;
  state: OrderState;
  fundingMode: FundingMode;
  targetUnits: number;
  claimedUnits: number;
  participantCount: number;
  checkoutVersion?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetailView extends OrderSummaryView {
  participants: ParticipantView[];
  checkout?: CheckoutView;
  paymentRequest?: PoolMatePaymentRequest;
  paymentProjection?: PaymentProjectionView;
  paymentOutbox?: PaymentOutboxView;
}

export interface ConfirmationView {
  orderId: string;
  orderTitle: string;
  participantDisplayName: string;
  checkoutVersion: number;
  checkoutHash: CheckoutHashView;
  merchant: MerchantView;
  items: CheckoutItemView[];
  participantUnits: number;
  goods: AtomicMoney;
  shipping: AtomicMoney;
  discount: AtomicMoney;
  fee: AtomicMoney;
  orderTotal: AtomicMoney;
  money: AtomicMoney;
  expiresAt: string;
  status: AllocationConfirmationStatus;
  confirmedAt?: string;
}

export interface ConfirmationResult {
  confirmation: ConfirmationView;
  orderState: OrderState;
  paymentRequestCreated: boolean;
}

export interface CreateGroupRequest {
  telegramChatId: string;
  title: string;
}

export interface CreateOrderRequest {
  groupId: string;
  ownerUserId: string;
  title: string;
  targetUnits: number;
  sourceIdempotencyKey?: string;
}

export interface ClaimOrderRequest {
  userId: string;
  displayName: string;
  units: number;
  sourceIdempotencyKey?: string;
}

export interface UpdateClaimRequest {
  units: number;
  sourceIdempotencyKey?: string;
}

export interface FinalizeCheckoutRequest {
  merchantId: string;
}

export interface FinalizeCheckoutResult {
  order: OrderDetailView;
  confirmationLinks: Array<{
    participantId: string;
    displayName: string;
    url: string;
  }>;
}
