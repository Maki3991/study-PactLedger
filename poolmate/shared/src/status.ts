export type ServiceHealth = "ok" | "degraded";

export type DatabaseStatus =
  | "ready"
  | "migration_required"
  | "migration_failed"
  | "unavailable";

export type SettlementMode = "disabled" | "mock" | "testnet" | "live";

export type BotStatus = "disabled" | "configured" | "running" | "error";

export type PaymentBaseStatus =
  | "not_configured"
  | "configured"
  | "unavailable";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ROUTE_NOT_FOUND"
  | "NOT_READY"
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
    allowedUserCount: number;
  };
  paymentBase: {
    status: PaymentBaseStatus;
    settlementMode: SettlementMode;
  };
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
}
