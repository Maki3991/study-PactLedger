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
    userAllowlistEnabled: boolean;
    allowedUserIds: string[];
    apiRoot: string;
    proxyUrl?: string;
    /**
     * Telegram allows only one long-polling consumer per bot token. The web/
     * runtime (web/server/poolmate/telegram.ts) owns the shared
     * TELEGRAM_BOT_TOKEN, so this standalone bot stays off unless explicitly
     * opted in with its own token. Starting both yields HTTP 409 Conflict.
     */
    standaloneBotEnabled: boolean;
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
    submitPath?: string;
    recoverPath?: string;
    timeoutMs: number;
  };
  llm: {
    enabled: boolean;
    provider: "deepseek" | "responses";
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
    maxInputChars: number;
  };
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
}

function parseTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 60_000
    ? parsed
    : fallback;
}

function parseMaxInputChars(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 200 && parsed <= 8_000
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

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string
): boolean {
  const normalized = optional(value)?.toLowerCase();
  if (normalized === undefined) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function parseSettlementMode(value: string | undefined): SettlementMode {
  const normalized = optional(value)?.toLowerCase();
  return normalized === "mock" ||
    normalized === "testnet" ||
    normalized === "live"
    ? normalized
    : "disabled";
}

function parseLlmProvider(
  value: string | undefined,
  fallback: "deepseek" | "responses"
): "deepseek" | "responses" {
  const normalized = optional(value)?.toLowerCase();
  if (normalized === undefined) return fallback;
  if (normalized === "deepseek" || normalized === "responses") {
    return normalized;
  }
  throw new Error("POOLMATE_LLM_PROVIDER must be deepseek or responses.");
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

function normalizeLlmBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "POOLMATE_LLM_BASE_URL must use HTTPS without credentials, query, or fragment."
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
  const aiPingApiKey = optional(env.AIPING_API_KEY);
  const deepSeekApiKey = optional(env.DEEPSEEK_API_KEY);
  const poolMateLlmApiKey = optional(env.POOLMATE_LLM_API_KEY);
  const llmApiKey = poolMateLlmApiKey ?? aiPingApiKey ?? deepSeekApiKey;
  const llmProvider = parseLlmProvider(
    env.POOLMATE_LLM_PROVIDER,
    aiPingApiKey ||
      deepSeekApiKey ||
      (!env.POOLMATE_LLM_BASE_URL && !env.POOLMATE_LLM_MODEL)
      ? "deepseek"
      : "responses"
  );
  const llmEnabled = parseBoolean(
    env.POOLMATE_LLM_ENABLED,
    Boolean(llmApiKey),
    "POOLMATE_LLM_ENABLED"
  );
  const llmBaseUrl =
    optional(env.POOLMATE_LLM_BASE_URL) ??
    (llmProvider === "deepseek" && llmEnabled
      ? aiPingApiKey
        ? (optional(env.AIPING_BASE_URL) ?? "https://aiping.cn/api/v1")
        : (optional(env.DEEPSEEK_BASE_URL) ?? "https://api.deepseek.com")
      : undefined);
  const llmModel =
    optional(env.POOLMATE_LLM_MODEL) ??
    (llmProvider === "deepseek" && llmEnabled
      ? aiPingApiKey
        ? (optional(env.AIPING_MODEL) ?? "DeepSeek-V3.2")
        : (optional(env.DEEPSEEK_MODEL) ?? "deepseek-v4-pro")
      : undefined);
  if (llmEnabled && (!llmBaseUrl || !llmApiKey || !llmModel)) {
    throw new Error(
      "The enabled LLM requires an API key, HTTPS base URL, and model. Set AIPING_API_KEY or DEEPSEEK_API_KEY for a default configuration, or provide the POOLMATE_LLM_* overrides."
    );
  }
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
      userAllowlistEnabled: parseBoolean(
        env.TELEGRAM_USER_ALLOWLIST_ENABLED,
        false,
        "TELEGRAM_USER_ALLOWLIST_ENABLED"
      ),
      allowedUserIds: parseCsv(env.TELEGRAM_ALLOWED_USER_IDS),
      apiRoot: optional(env.TELEGRAM_API_ROOT) ?? "https://api.telegram.org",
      proxyUrl: optional(env.TELEGRAM_PROXY_URL),
      standaloneBotEnabled: parseBoolean(
        env.POOLMATE_STANDALONE_BOT,
        false,
        "POOLMATE_STANDALONE_BOT"
      )
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
      settlementMode: parseSettlementMode(env.PAYMENT_SETTLEMENT_MODE),
      submitPath: optional(env.PAYMENT_BASE_SUBMIT_PATH),
      recoverPath: optional(env.PAYMENT_BASE_RECOVER_PATH),
      timeoutMs: parseTimeout(env.PAYMENT_BASE_TIMEOUT_MS, 10_000)
    },
    llm: {
      enabled: llmEnabled,
      provider: llmProvider,
      baseUrl: llmBaseUrl ? normalizeLlmBaseUrl(llmBaseUrl) : undefined,
      apiKey: llmApiKey,
      model: llmModel,
      timeoutMs: parseTimeout(env.POOLMATE_LLM_TIMEOUT_MS, 30_000),
      maxInputChars: parseMaxInputChars(env.POOLMATE_LLM_MAX_INPUT_CHARS, 2_000)
    }
  };
}
