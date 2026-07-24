import type {
  ApiErrorBody,
  BotStatus,
  ConfigStatusResponse,
  DatabaseStatus,
  HealthResponse,
  PaymentBaseStatus,
  ServiceHealth,
  SettlementMode
} from "@poolmate/shared";

const REQUEST_TIMEOUT_MS = 8_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type Parser<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

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
const settlementModeValues: readonly SettlementMode[] = [
  "disabled",
  "mock",
  "testnet",
  "live"
];

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (!isRecord(value) || !isRecord(value.database) || !isRecord(value.bot)) {
    return false;
  }

  return (
    value.service === "poolmate-api" &&
    typeof value.version === "string" &&
    isOneOf(value.status, serviceHealthValues) &&
    typeof value.checkedAt === "string" &&
    !Number.isNaN(Date.parse(value.checkedAt)) &&
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
    !isRecord(value.paymentBase)
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
    isNonNegativeInteger(value.bot.allowedUserCount) &&
    isOneOf(value.paymentBase.status, paymentStatusValues) &&
    isOneOf(value.paymentBase.settlementMode, settlementModeValues)
  );
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    typeof value.error.requestId === "string"
  );
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function configuredApiBaseUrl(): string {
  return normalizeBaseUrl(import.meta.env.VITE_POOLMATE_API_BASE_URL ?? "");
}

function endpointUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  parser: Parser<T>,
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }
  const timeout = window.setTimeout(
    () => controller.abort(new Error("Request timed out")),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(endpointUrl(baseUrl, path), {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      if (isApiErrorBody(body)) {
        throw new ApiRequestError(body.error.message, body.error.code);
      }
      throw new ApiRequestError(
        `PoolMate API returned HTTP ${response.status}.`,
        `HTTP_${response.status}`
      );
    }

    if (!parser(body)) {
      throw new ApiRequestError(
        "PoolMate API returned an invalid status response.",
        "INVALID_RESPONSE"
      );
    }

    return body;
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error;
    }
    if (controller.signal.aborted && !signal?.aborted) {
      throw new ApiRequestError(
        "PoolMate API did not respond before the timeout.",
        "REQUEST_TIMEOUT"
      );
    }
    if (signal?.aborted) {
      throw error;
    }
    throw new ApiRequestError(
      "PoolMate API is unreachable. Check the backend and API URL.",
      "NETWORK_ERROR"
    );
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface StatusApi {
  getHealth(signal?: AbortSignal): Promise<HealthResponse>;
  getConfigStatus(signal?: AbortSignal): Promise<ConfigStatusResponse>;
}

export function createStatusApi(baseUrl = configuredApiBaseUrl()): StatusApi {
  return {
    getHealth: (signal) =>
      requestJson(baseUrl, "/health", isHealthResponse, signal),
    getConfigStatus: (signal) =>
      requestJson(
        baseUrl,
        "/api/public/config-status",
        isConfigStatusResponse,
        signal
      )
  };
}
