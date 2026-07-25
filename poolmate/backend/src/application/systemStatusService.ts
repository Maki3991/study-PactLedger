import type {
  BotStatus,
  ConfigStatusResponse,
  HealthResponse
} from "@poolmate/shared";
import type { PoolMateConfig } from "../config.js";
import type { PoolMateDatabase } from "../infrastructure/db/database.js";

export interface SystemStatusDependencies {
  config: PoolMateConfig;
  database: PoolMateDatabase;
  getBotStatus: () => BotStatus;
}

export class SystemStatusService {
  constructor(private readonly dependencies: SystemStatusDependencies) {}

  health(): HealthResponse {
    const databaseReady = this.dependencies.database.ping();
    const migrations = this.dependencies.database.migrationState();
    const botStatus = this.dependencies.getBotStatus();
    const databaseStatus = !databaseReady
      ? "unavailable"
      : migrations.failed
        ? "migration_failed"
        : migrations.pending > 0
          ? "migration_required"
          : "ready";

    return {
      service: "poolmate-api",
      version: this.dependencies.config.app.version,
      status:
        databaseStatus === "ready" && botStatus !== "error" ? "ok" : "degraded",
      checkedAt: new Date().toISOString(),
      database: {
        status: databaseStatus,
        appliedMigrations: migrations.applied,
        pendingMigrations: migrations.pending
      },
      bot: {
        framework: "grammy",
        status: botStatus
      }
    };
  }

  configStatus(): ConfigStatusResponse {
    const { config } = this.dependencies;
    const health = this.health();
    const botStatus = this.dependencies.getBotStatus();

    return {
      mode: "sponsored_demo",
      publicBaseUrl: config.app.publicBaseUrl,
      database: {
        ...health.database,
        dialect: "sqlite"
      },
      bot: {
        framework: "grammy",
        status: botStatus,
        userAllowlistEnabled: config.telegram.userAllowlistEnabled,
        allowedUserCount: config.telegram.allowedUserIds.length
      },
      paymentBase: {
        status:
          config.paymentBase.settlementMode === "mock" ||
          (config.paymentBase.url &&
            config.paymentBase.apiKey &&
            config.paymentBase.submitPath &&
            config.paymentBase.recoverPath &&
            config.paymentBase.settlementMode !== "disabled")
            ? "configured"
            : "not_configured",
        settlementMode: config.paymentBase.settlementMode
      }
    };
  }
}
