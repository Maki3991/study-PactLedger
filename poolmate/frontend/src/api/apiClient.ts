import type { ApiErrorBody } from "@poolmate/shared";

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

export type Parser<T> = (value: unknown) => value is T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.includes(value as T);
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

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  parser: Parser<T>,
  options: {
    signal?: AbortSignal;
    method?: "GET" | "POST";
    body?: object;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener("abort", onAbort, { once: true });
  }
  const timeout = window.setTimeout(
    () => controller.abort(new Error("Request timed out")),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(endpointUrl(baseUrl, path), {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
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
        "PoolMate API returned an invalid response.",
        "INVALID_RESPONSE"
      );
    }

    return body;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new ApiRequestError(
        "PoolMate API did not respond before the timeout.",
        "REQUEST_TIMEOUT"
      );
    }
    if (options.signal?.aborted) throw error;
    throw new ApiRequestError(
      "PoolMate API is unreachable. Check the backend and API URL.",
      "NETWORK_ERROR"
    );
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
