import {
  Bot,
  CircleDollarSign,
  Database,
  RefreshCw,
  Server,
  TriangleAlert
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  BotStatus,
  ConfigStatusResponse,
  HealthResponse,
  PaymentBaseStatus,
  SettlementMode
} from "@poolmate/shared";
import { configuredApiBaseUrl, type StatusApi } from "./api/statusApi";
import type { OrdersApi } from "./api/ordersApi";
import {
  ConsoleHeader,
  type ConsoleView
} from "./components/ConsoleHeader";
import { StatusCard, type Severity } from "./components/StatusCard";
import {
  type ResourceState,
  useStatusDashboard
} from "./hooks/useStatusDashboard";
import { ConfirmationSurface } from "./orders/ConfirmationSurface";
import { OrdersView } from "./orders/OrdersView";
import { consumeConfirmationTokenFromLocation } from "./orders/confirmationToken";

interface AppProps {
  api?: StatusApi;
  ordersApi?: OrdersApi;
  confirmationToken?: string;
}

interface RuntimeViewProps {
  api?: StatusApi;
  onNavigate(view: ConsoleView): void;
}

interface DisplayState {
  label: string;
  detail: string;
  rawStatus?: string;
  severity: Severity;
  loading?: boolean;
}

const botStates: Record<BotStatus, Omit<DisplayState, "rawStatus">> = {
  disabled: {
    label: "Disabled",
    detail: "No Telegram token is configured. The grammY bot is not running.",
    severity: "warning"
  },
  configured: {
    label: "Configured",
    detail: "grammY credentials are configured; the runtime is not marked running.",
    severity: "warning"
  },
  running: {
    label: "Running",
    detail: "The grammY Telegram runtime is active.",
    severity: "healthy"
  },
  error: {
    label: "Error",
    detail: "The grammY Telegram runtime reported an error.",
    severity: "error"
  }
};

const paymentBaseDetails: Record<PaymentBaseStatus, string> = {
  not_configured: "No external payment base is configured.",
  configured: "The external payment base endpoint is configured.",
  unavailable: "The external payment base is unavailable."
};

const settlementModeLabels: Record<SettlementMode, string> = {
  disabled: "Disabled",
  mock: "Mock only",
  testnet: "Testnet",
  live: "Live"
};

function resourceError<T>(resource: ResourceState<T>): DisplayState | undefined {
  if (resource.state !== "error") return undefined;
  return {
    label: "Unavailable",
    detail: resource.error.message,
    rawStatus: resource.error.code,
    severity: "error"
  };
}

function serviceDisplay(
  health: ResourceState<HealthResponse>
): DisplayState {
  const error = resourceError(health);
  if (error && !health.data) return error;
  if (!health.data) {
    return {
      label: "Checking",
      detail: "Waiting for the PoolMate API health response.",
      severity: "neutral",
      loading: true
    };
  }
  if (health.state === "error") return error!;
  if (health.data.status === "ok") {
    return {
      label: "Healthy",
      detail: "The PoolMate API is responding normally.",
      rawStatus: health.data.status,
      severity: "healthy",
      loading: health.state === "loading"
    };
  }
  return {
    label: "Degraded",
    detail: "The PoolMate API is responding with degraded health.",
    rawStatus: health.data.status,
    severity: "warning",
    loading: health.state === "loading"
  };
}

function databaseDisplay(
  health: ResourceState<HealthResponse>,
  config: ResourceState<ConfigStatusResponse>
): DisplayState {
  const healthStatus = health.data?.database.status;
  const configStatus = config.data?.database.status;
  if (healthStatus && configStatus && healthStatus !== configStatus) {
    return {
      label: "Status mismatch",
      detail: "Health and configuration endpoints disagree about database state.",
      rawStatus: `${healthStatus} / ${configStatus}`,
      severity: "error"
    };
  }
  const value = healthStatus ?? configStatus;
  if (value === "ready") {
    const pending = Math.max(
      health.data?.database.pendingMigrations ?? 0,
      config.data?.database.pendingMigrations ?? 0
    );
    if (pending > 0) {
      return {
        label: "Status mismatch",
        detail: "The database reports ready while migrations are still pending.",
        rawStatus: `ready / pending:${pending}`,
        severity: "error"
      };
    }
    return {
      label: "Ready",
      detail: `The independent ${config.data?.database.dialect ?? "PoolMate"} database is available with ${pending} pending migrations.`,
      rawStatus: value,
      severity: "healthy",
      loading: health.state === "loading" || config.state === "loading"
    };
  }
  if (value) {
    const states: Record<Exclude<typeof value, "ready">, DisplayState> = {
      migration_required: {
        label: "Migration required",
        detail: "The database is reachable but pending migrations block readiness.",
        rawStatus: value,
        severity: "warning"
      },
      migration_failed: {
        label: "Migration failed",
        detail: "A PoolMate database migration failed. The service is not ready.",
        rawStatus: value,
        severity: "error"
      },
      unavailable: {
        label: "Unavailable",
        detail: "The PoolMate database is not available.",
        rawStatus: value,
        severity: "error"
      }
    };
    return {
      ...states[value],
      loading: health.state === "loading" || config.state === "loading"
    };
  }
  const error = resourceError(health) ?? resourceError(config);
  return (
    error ?? {
      label: "Checking",
      detail: "Waiting for database status.",
      severity: "neutral",
      loading: true
    }
  );
}

function botDisplay(
  health: ResourceState<HealthResponse>,
  config: ResourceState<ConfigStatusResponse>
): DisplayState {
  const healthStatus = health.data?.bot.status;
  const configStatus = config.data?.bot.status;
  if (healthStatus && configStatus && healthStatus !== configStatus) {
    return {
      label: "Status mismatch",
      detail: "Health and configuration endpoints disagree about grammY state.",
      rawStatus: `${healthStatus} / ${configStatus}`,
      severity: "error"
    };
  }
  const value = healthStatus ?? configStatus;
  if (value) {
    return {
      ...botStates[value],
      rawStatus: value,
      loading: health.state === "loading" || config.state === "loading"
    };
  }
  const error = resourceError(health) ?? resourceError(config);
  return (
    error ?? {
      label: "Checking",
      detail: "Waiting for grammY bot status.",
      severity: "neutral",
      loading: true
    }
  );
}

function paymentDisplay(
  config: ResourceState<ConfigStatusResponse>
): DisplayState {
  if (config.data) {
    const { status, settlementMode } = config.data.paymentBase;
    const invalidCombination =
      status === "not_configured" && settlementMode !== "disabled";
    const severity: Severity =
      status === "unavailable" || invalidCombination
        ? "error"
        : "warning";
    const detail = invalidCombination
      ? "Settlement is enabled without a configured payment base."
      : settlementMode === "mock"
        ? "The local persisted Mock Payment Base is enabled. No funds move and no chain transaction is created."
        : `${paymentBaseDetails[status]} ${
            settlementMode === "disabled"
              ? "Settlement is disabled."
              : "Configuration is not settlement evidence."
          }`;
    return {
      label: invalidCombination
        ? "Configuration mismatch"
        : status === "unavailable"
          ? "Unavailable"
          : settlementModeLabels[settlementMode],
      detail,
      severity,
      rawStatus: `mode:${settlementMode} / base:${status}`,
      loading: config.state === "loading"
    };
  }
  return (
    resourceError(config) ?? {
      label: "Checking",
      detail: "Waiting for payment base configuration status.",
      severity: "neutral",
      loading: true
    }
  );
}

function formatTimestamp(value?: string): string {
  if (!value) return "Awaiting response";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function RuntimeView({ api, onNavigate }: RuntimeViewProps) {
  const { health, config, refresh, isRefreshing } = useStatusDashboard(api);
  const service = serviceDisplay(health);
  const database = databaseDisplay(health, config);
  const bot = botDisplay(health, config);
  const payment = paymentDisplay(config);
  const displays = [service, database, bot, payment];
  const hasError = displays.some((item) => item.severity === "error");
  const hasWarning = displays.some((item) => item.severity === "warning");
  const overall = isRefreshing
    ? { label: "Checking systems", severity: "neutral" as const }
    : hasError
      ? { label: "Action required", severity: "error" as const }
      : hasWarning
        ? { label: "Operational limits", severity: "warning" as const }
        : { label: "All systems ready", severity: "healthy" as const };
  const apiBaseUrl = configuredApiBaseUrl();
  const errors = [health, config].filter(
    (resource): resource is Extract<typeof resource, { state: "error" }> =>
      resource.state === "error"
  );
  const errorMessages = [
    ...new Set(errors.map((resource) => resource.error.message))
  ];

  return (
    <main className="app-shell">
      <ConsoleHeader
        activeView="runtime"
        onNavigate={onNavigate}
        actions={
          <>
          <span className={`overall overall--${overall.severity}`} role="status">
            <span aria-hidden="true" />
            {overall.label}
          </span>
          <button type="button" onClick={refresh} disabled={isRefreshing}>
            <RefreshCw
              className={isRefreshing ? "spin" : undefined}
              size={16}
              aria-hidden="true"
            />
            Refresh status
          </button>
          </>
        }
      />

      <div className="content">
        {errors.length > 0 ? (
          <section className="error-banner" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>Backend status is incomplete</strong>
              <p>{errorMessages.join(" ")}</p>
            </div>
            <button type="button" onClick={refresh} disabled={isRefreshing}>
              Retry
            </button>
          </section>
        ) : null}

        <section aria-labelledby="runtime-heading">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Live backend responses</p>
              <h2 id="runtime-heading">Runtime systems</h2>
            </div>
            <p className="checked-at">
              Last checked: {formatTimestamp(health.data?.checkedAt)}
            </p>
          </div>

          <div className="status-grid">
            <StatusCard title="Service" icon={Server} {...service} />
            <StatusCard title="Database" icon={Database} {...database} />
            <StatusCard title="Telegram bot" icon={Bot} {...bot} />
            <StatusCard
              title="Payment base"
              icon={CircleDollarSign}
              {...payment}
            />
          </div>
        </section>

        <section className="runtime-facts" aria-labelledby="facts-heading">
          <div className="section-heading section-heading--facts">
            <div>
              <p className="section-kicker">Reported configuration</p>
              <h2 id="facts-heading">Runtime facts</h2>
            </div>
          </div>
          <dl>
            <div>
              <dt>Service version</dt>
              <dd>{health.data?.version ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Funding mode</dt>
              <dd>{config.data?.mode ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Settlement mode</dt>
              <dd>{config.data?.paymentBase.settlementMode ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Telegram user allowlist</dt>
              <dd>
                {config.data
                  ? config.data.bot.userAllowlistEnabled
                    ? `${config.data.bot.allowedUserCount} users`
                    : "Disabled"
                  : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Public base URL</dt>
              <dd>{config.data?.publicBaseUrl || "Not reported"}</dd>
            </div>
            <div>
              <dt>Dashboard API</dt>
              <dd>{apiBaseUrl || "Same origin"}</dd>
            </div>
          </dl>
        </section>

        <footer>
          <span>PoolMate independent runtime</span>
          <span>Payment status is configuration only, not settlement evidence.</span>
        </footer>
      </div>
    </main>
  );
}

function readConsoleView(): ConsoleView {
  return new URLSearchParams(window.location.search).get("view") === "orders"
    ? "orders"
    : "runtime";
}

export default function App({
  api,
  ordersApi,
  confirmationToken
}: AppProps) {
  const isConfirmationRoute = /^\/confirm\/?$/.test(window.location.pathname);
  const [routeToken] = useState(() => {
    const locationToken = consumeConfirmationTokenFromLocation();
    return confirmationToken ?? locationToken;
  });
  const [view, setView] = useState<ConsoleView>(readConsoleView);

  useEffect(() => {
    const handlePopState = () => setView(readConsoleView());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((nextView: ConsoleView) => {
    const url = new URL(window.location.href);
    if (nextView === "runtime") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", nextView);
    }
    window.history.pushState({}, "", url);
    setView(nextView);
  }, []);

  if (isConfirmationRoute) {
    return <ConfirmationSurface token={routeToken} api={ordersApi} />;
  }
  return view === "orders" ? (
    <OrdersView api={ordersApi} onNavigate={navigate} />
  ) : (
    <RuntimeView api={api} onNavigate={navigate} />
  );
}
