import type {
  BotStatus,
  ConfigStatusResponse,
  DatabaseStatus,
  HealthResponse,
  LlmStatus,
  PaymentBaseStatus,
  ServiceHealth,
  SettlementMode
} from "@poolmate/shared";
import {
  configuredApiBaseUrl,
  isIsoDate,
  isNonNegativeInteger,
  isOneOf,
  isRecord,
  requestJson
} from "./apiClient";

export { ApiRequestError, configuredApiBaseUrl } from "./apiClient";

const serviceHealthValues: readonly ServiceHealth[] = ["ok", "degraded"];
const databaseStatusValues: readonly DatabaseStatus[] = [
  "ready",
  "migration_required",
  "migration_failed",
  "unavailable"
];
const botStatusValues: readonly BotStatus[] = [
  "disabled",
  "configured",
  "running",
  "error"
];
const paymentStatusValues: readonly PaymentBaseStatus[] = [
  "not_configured",
  "configured",
  "unavailable"
];
const llmStatusValues: readonly LlmStatus[] = [
  "disabled",
  "configured",
  "unavailable"
];
const settlementModeValues: readonly SettlementMode[] = [
  "disabled",
  "mock",
  "testnet",
  "live"
];

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (!isRecord(value) || !isRecord(value.database) || !isRecord(value.bot)) {
    return false;
  }

  return (
    value.service === "poolmate-api" &&
    typeof value.version === "string" &&
    isOneOf(value.status, serviceHealthValues) &&
    isIsoDate(value.checkedAt) &&
    isOneOf(value.database.status, databaseStatusValues) &&
    isNonNegativeInteger(value.database.appliedMigrations) &&
    isNonNegativeInteger(value.database.pendingMigrations) &&
    value.bot.framework === "grammy" &&
    isOneOf(value.bot.status, botStatusValues)
  );
}

export function isConfigStatusResponse(
  value: unknown
): value is ConfigStatusResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.database) ||
    !isRecord(value.bot) ||
    !isRecord(value.paymentBase) ||
    !isRecord(value.llm)
  ) {
    return false;
  }

  return (
    value.mode === "sponsored_demo" &&
    typeof value.publicBaseUrl === "string" &&
    isOneOf(value.database.status, databaseStatusValues) &&
    value.database.dialect === "sqlite" &&
    isNonNegativeInteger(value.database.appliedMigrations) &&
    isNonNegativeInteger(value.database.pendingMigrations) &&
    value.bot.framework === "grammy" &&
    isOneOf(value.bot.status, botStatusValues) &&
    typeof value.bot.userAllowlistEnabled === "boolean" &&
    isNonNegativeInteger(value.bot.allowedUserCount) &&
    isOneOf(value.paymentBase.status, paymentStatusValues) &&
    isOneOf(value.paymentBase.settlementMode, settlementModeValues) &&
    isOneOf(value.llm.status, llmStatusValues) &&
    (value.llm.model === undefined || typeof value.llm.model === "string")
  );
}

export interface StatusApi {
  getHealth(signal?: AbortSignal): Promise<HealthResponse>;
  getConfigStatus(signal?: AbortSignal): Promise<ConfigStatusResponse>;
}

export function createStatusApi(baseUrl = configuredApiBaseUrl()): StatusApi {
  return {
    getHealth: (signal) =>
      requestJson(baseUrl, "/health", isHealthResponse, { signal }),
    getConfigStatus: (signal) =>
      requestJson(
        baseUrl,
        "/api/public/config-status",
        isConfigStatusResponse,
        { signal }
      )
  };
}
