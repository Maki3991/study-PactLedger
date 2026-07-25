export type ServiceHealth = "ok" | "degraded";

export type DatabaseStatus =
  | "ready"
  | "migration_required"
  | "migration_failed"
  | "unavailable";

export type SettlementMode = "disabled" | "mock" | "testnet" | "live";

export type BotStatus = "disabled" | "configured" | "running" | "error";

export type PaymentBaseStatus = "not_configured" | "configured" | "unavailable";

export type LlmStatus = "disabled" | "configured" | "unavailable";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ROUTE_NOT_FOUND"
  | "NOT_READY"
  | "GROUP_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "PARTICIPANT_NOT_FOUND"
  | "INVALID_ORDER_STATE"
  | "ORDER_CANCELLATION_NOT_ALLOWED"
  | "CAPACITY_EXCEEDED"
  | "MERCHANT_NOT_VERIFIED"
  | "INVALID_CHECKOUT"
  | "CHECKOUT_EXPIRED"
  | "CONFIRMATION_TOKEN_REQUIRED"
  | "CONFIRMATION_NOT_FOUND"
  | "CONFIRMATION_SUPERSEDED"
  | "CONFIRMATION_IDENTITY_REQUIRED"
  | "CONFIRMATION_IDENTITY_INVALID"
  | "CONFIRMATION_ACTOR_MISMATCH"
  | "INVALID_CONFIRMATION_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYMENT_BASE_UNAVAILABLE"
  | "PAYMENT_APPROVAL_REQUIRED"
  | "PAYMENT_AMOUNT_UNSUPPORTED"
  | "PAYMENT_OPERATION_UNKNOWN"
  | "PAYMENT_RECOVERY_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface LivenessResponse {
  service: "poolmate-api";
  status: "ok";
  checkedAt: string;
}

export interface HealthResponse {
  service: "poolmate-api";
  version: string;
  status: ServiceHealth;
  checkedAt: string;
  database: {
    status: DatabaseStatus;
    appliedMigrations: number;
    pendingMigrations: number;
  };
  bot: {
    framework: "grammy";
    status: BotStatus;
  };
}

export interface ConfigStatusResponse {
  mode: "sponsored_demo";
  publicBaseUrl: string;
  database: {
    status: DatabaseStatus;
    dialect: "sqlite";
    appliedMigrations: number;
    pendingMigrations: number;
  };
  bot: {
    framework: "grammy";
    status: BotStatus;
    userAllowlistEnabled: boolean;
    allowedUserCount: number;
  };
  paymentBase: {
    status: PaymentBaseStatus;
    settlementMode: SettlementMode;
  };
  llm: {
    status: LlmStatus;
    model?: string;
  };
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
}
