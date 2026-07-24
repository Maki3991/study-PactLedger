import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import type { SettlementMode } from "@poolmate/shared";

dotenv.config();

export interface PoolMateConfig {
  app: {
    version: string;
    host: string;
    port: number;
    publicBaseUrl: string;
  };
  database: {
    path: string;
    migrationsDir: string;
  };
  telegram: {
    token?: string;
    allowedUserIds: string[];
    apiRoot: string;
    proxyUrl?: string;
  };
  admin: {
    apiKey?: string;
  };
  funding: {
    mode: "sponsored_demo";
    payerRef: string;
  };
  paymentBase: {
    url?: string;
    apiKey?: string;
    settlementMode: SettlementMode;
  };
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
}

function parseCsv(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function parseSettlementMode(value: string | undefined): SettlementMode {
  const normalized = optional(value)?.toLowerCase();
  return normalized === "mock" ||
    normalized === "testnet" ||
    normalized === "live"
    ? normalized
    : "disabled";
}

function normalizePublicBaseUrl(
  value: string | undefined,
  fallback: string
): string {
  const url = new URL(optional(value) ?? fallback);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("POOLMATE_PUBLIC_BASE_URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "POOLMATE_PUBLIC_BASE_URL cannot contain credentials, query, or fragment."
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): PoolMateConfig {
  const host = optional(env.POOLMATE_HOST) ?? "127.0.0.1";
  const port = parsePort(env.POOLMATE_PORT, 8788);
  const telegramToken = optional(env.TELEGRAM_BOT_TOKEN);
  const publicBaseUrl = normalizePublicBaseUrl(
    env.POOLMATE_PUBLIC_BASE_URL,
    `http://${host}:${port}`
  );
  const publicUrl = new URL(publicBaseUrl);
  if (
    telegramToken &&
    (publicUrl.protocol !== "https:" || publicUrl.hostname.endsWith(".invalid"))
  ) {
    throw new Error(
      "Telegram requires POOLMATE_PUBLIC_BASE_URL to be an external HTTPS frontend origin."
    );
  }

  return {
    app: {
      version: "0.1.0",
      host,
      port,
      publicBaseUrl
    },
    database: {
      path: path.resolve(
        cwd,
        optional(env.POOLMATE_DATABASE_PATH) ?? "data/poolmate.sqlite"
      ),
      migrationsDir: path.resolve(
        cwd,
        optional(env.POOLMATE_MIGRATIONS_DIR) ?? "../migrations"
      )
    },
    telegram: {
      token: telegramToken,
      allowedUserIds: parseCsv(env.TELEGRAM_ALLOWED_USER_IDS),
      apiRoot: optional(env.TELEGRAM_API_ROOT) ?? "https://api.telegram.org",
      proxyUrl: optional(env.TELEGRAM_PROXY_URL)
    },
    admin: {
      apiKey: optional(env.POOLMATE_ADMIN_API_KEY)
    },
    funding: {
      mode: "sponsored_demo",
      payerRef:
        optional(env.POOLMATE_SPONSORED_PAYER_REF) ?? "poolmate-sponsored-demo"
    },
    paymentBase: {
      url: optional(env.PAYMENT_BASE_URL),
      apiKey: optional(env.PAYMENT_BASE_API_KEY),
      settlementMode: parseSettlementMode(env.PAYMENT_SETTLEMENT_MODE)
    }
  };
}
