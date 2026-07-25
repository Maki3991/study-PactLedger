import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  ConfigStatusResponse,
  HealthResponse
} from "@poolmate/shared";
import App from "./App";
import { ApiRequestError, type StatusApi } from "./api/statusApi";

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
  bot: {
    framework: "grammy",
    status: "disabled",
    userAllowlistEnabled: false,
    allowedUserCount: 0
  },
  paymentBase: { status: "not_configured", settlementMode: "disabled" },
  llm: { status: "disabled" }
};

describe("PoolMate operations dashboard", () => {
  it("shows loading state and then the backend's explicit truth labels", async () => {
    let resolveHealth!: (value: HealthResponse) => void;
    const healthPromise = new Promise<HealthResponse>((resolve) => {
      resolveHealth = resolve;
    });
    const api: StatusApi = {
      getHealth: vi.fn(() => healthPromise),
      getConfigStatus: vi.fn(async () => config)
    };

    render(<App api={api} />);
    expect(screen.getByLabelText("Service: Checking")).toBeInTheDocument();

    resolveHealth(health);

    expect(await screen.findByLabelText("Service: Healthy")).toBeInTheDocument();
    expect(screen.getByLabelText("Database: Ready")).toBeInTheDocument();
    expect(screen.getByLabelText("Telegram bot: Disabled")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Payment base: Disabled")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No external payment base is configured/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Telegram user allowlist").parentElement
    ).toHaveTextContent("Disabled");
    expect(
      screen.getByText("Natural-language drafts").parentElement
    ).toHaveTextContent("disabled");
    expect(screen.queryByText(/paid/i)).not.toBeInTheDocument();
  });

  it("shows an API error and retries both endpoints", async () => {
    const api: StatusApi = {
      getHealth: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiRequestError("PoolMate API is unreachable.", "NETWORK_ERROR")
        )
        .mockResolvedValueOnce(health),
      getConfigStatus: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiRequestError("PoolMate API is unreachable.", "NETWORK_ERROR")
        )
        .mockResolvedValueOnce(config)
    };
    const user = userEvent.setup();

    render(<App api={api} />);

    expect(await screen.findByText("Backend status is incomplete")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Service: Healthy")).toBeInTheDocument();
    });
    expect(api.getHealth).toHaveBeenCalledTimes(2);
    expect(api.getConfigStatus).toHaveBeenCalledTimes(2);
  });

  it("describes Mock as a local non-chain payment base", async () => {
    const api: StatusApi = {
      getHealth: vi.fn(async () => health),
      getConfigStatus: vi.fn(
        async (): Promise<ConfigStatusResponse> => ({
          ...config,
          paymentBase: { status: "configured", settlementMode: "mock" }
        })
      )
    };

    render(<App api={api} />);

    expect(await screen.findByLabelText("Payment base: Mock only")).toBeVisible();
    expect(
      screen.getByText(/local persisted Mock Payment Base is enabled/)
    ).toBeVisible();
    expect(screen.getByText(/No funds move/)).toBeVisible();
    expect(
      screen.queryByText(/external payment base endpoint is configured/)
    ).not.toBeInTheDocument();
  });

  it("flags disagreement between health and config without guessing", async () => {
    const api: StatusApi = {
      getHealth: vi.fn(async () => health),
      getConfigStatus: vi.fn(
        async (): Promise<ConfigStatusResponse> => ({
          ...config,
          database: { ...config.database, status: "unavailable" }
        })
      )
    };

    render(<App api={api} />);

    expect(
      await screen.findByLabelText("Database: Status mismatch")
    ).toBeInTheDocument();
    expect(screen.getByText("Action required")).toBeInTheDocument();
  });
});
