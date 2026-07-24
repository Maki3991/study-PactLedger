import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConfigStatusResponse,
  HealthResponse
} from "@poolmate/shared";
import { ApiRequestError, createStatusApi } from "./statusApi";

const health: HealthResponse = {
  service: "poolmate-api",
  version: "0.1.0",
  status: "ok",
  checkedAt: "2026-07-25T00:00:00.000Z",
  database: { status: "ready", appliedMigrations: 1, pendingMigrations: 0 },
  bot: { framework: "grammy", status: "disabled" }
};

const config: ConfigStatusResponse = {
  mode: "sponsored_demo",
  publicBaseUrl: "http://localhost:8788",
  database: {
    status: "ready",
    dialect: "sqlite",
    appliedMigrations: 1,
    pendingMigrations: 0
  },
  bot: { framework: "grammy", status: "disabled", allowedUserCount: 0 },
  paymentBase: { status: "not_configured", settlementMode: "disabled" }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("status API", () => {
  it("loads and validates both backend status endpoints", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(health)))
      .mockResolvedValueOnce(new Response(JSON.stringify(config)));
    const api = createStatusApi("https://poolmate.test/");

    await expect(api.getHealth()).resolves.toEqual(health);
    await expect(api.getConfigStatus()).resolves.toEqual(config);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://poolmate.test/health",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://poolmate.test/api/public/config-status",
      expect.any(Object)
    );
  });

  it("rejects a successful response that violates the shared contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...health, service: "another-api" }))
    );

    await expect(createStatusApi().getHealth()).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    } satisfies Partial<ApiRequestError>);
  });

  it("preserves the backend stable error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database check failed.",
            requestId: "request-1"
          }
        }),
        { status: 503 }
      )
    );

    await expect(createStatusApi().getHealth()).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      message: "Database check failed."
    } satisfies Partial<ApiRequestError>);
  });
});
