import { Bot, type BotConfig, type PollingOptions } from "grammy";
import type { BotStatus } from "@poolmate/shared";
import type { AgentRuntimeStatus } from "../../agent/agentRuntime.js";
import type { BotAdapter } from "../botAdapter.js";
import type { PoolMateBotUseCases } from "../poolMateBotUseCases.js";
import { message, resolveLocale } from "../i18n.js";
import type { PoolMateContext } from "./context.js";
import { registerSystemHandlers } from "./handlers/systemHandlers.js";
import { registerPoolHandlers } from "./handlers/poolHandlers.js";
import { createAccessMiddleware } from "./middleware.js";
import { createProxyFetch } from "./proxyFetch.js";

const DEFAULT_API_ROOT = "https://api.telegram.org";

export interface CreateGrammyBotConfig {
  token: string;
  userAllowlistEnabled: boolean;
  allowedUserIds: string[];
  apiRoot?: string;
  proxyUrl?: string;
  fetch?: NonNullable<BotConfig<PoolMateContext>["client"]>["fetch"];
  getBotStatus(): BotStatus;
  getAgentStatus?(): AgentRuntimeStatus;
  useCases?: PoolMateBotUseCases;
}

export interface BotRuntimeConfig {
  token?: string;
  userAllowlistEnabled: boolean;
  allowedUserIds: string[];
  apiRoot?: string;
  proxyUrl?: string;
  getAgentStatus?(): AgentRuntimeStatus;
  useCases?: PoolMateBotUseCases;
}

interface GrammyBotController {
  init(): Promise<void>;
  start(options?: PollingOptions): Promise<void>;
  stop(): Promise<void>;
}

export interface BotRuntimeDependencies {
  createBot?: (config: CreateGrammyBotConfig) => GrammyBotController;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Telegram error";
}

export function createPoolMateBot(
  config: CreateGrammyBotConfig
): Bot<PoolMateContext> {
  const bot = new Bot<PoolMateContext>(config.token, {
    client: {
      apiRoot: config.apiRoot || DEFAULT_API_ROOT,
      timeoutSeconds: 30,
      sensitiveLogs: false,
      ...(config.fetch ? { fetch: config.fetch } : {})
    }
  });

  bot.use(
    createAccessMiddleware(config.userAllowlistEnabled, config.allowedUserIds)
  );
  registerSystemHandlers(bot, {
    getBotStatus: config.getBotStatus,
    getAgentStatus: config.getAgentStatus
  });
  if (config.useCases) {
    registerPoolHandlers(bot, { useCases: config.useCases });
  }

  bot.catch(async ({ error, ctx }) => {
    console.error(
      `[telegram] update handling failed: ${safeErrorMessage(error)}`
    );
    const locale = resolveLocale(ctx.from?.language_code);
    await ctx.reply(message(locale, "unavailable")).catch(() => undefined);
  });

  return bot;
}

export function createBotRuntime(
  config: BotRuntimeConfig,
  dependencies: BotRuntimeDependencies = {}
): BotAdapter {
  const token = config.token?.trim() || "";
  const accessConfigured =
    !config.userAllowlistEnabled || config.allowedUserIds.length > 0;
  let status: BotStatus = token
    ? accessConfigured
      ? "configured"
      : "error"
    : "disabled";
  let pollingStarted = false;
  let pollingPromise: Promise<void> | null = null;
  let activationPromise: Promise<void> | null = null;

  const createBot = dependencies.createBot ?? createPoolMateBot;
  const bot =
    token && accessConfigured
      ? createBot({
          token,
          userAllowlistEnabled: config.userAllowlistEnabled,
          allowedUserIds: config.allowedUserIds,
          apiRoot: config.apiRoot,
          fetch: createProxyFetch(config.proxyUrl),
          getBotStatus: () => status,
          getAgentStatus: config.getAgentStatus,
          useCases: config.useCases
        })
      : null;

  return {
    getStatus: () => status,

    async start(): Promise<void> {
      if (!bot || status === "running") return;
      if (activationPromise) return activationPromise;

      activationPromise = (async () => {
        try {
          await bot.init();
          pollingStarted = true;
          pollingPromise = bot.start({
            allowed_updates: ["message", "callback_query"]
          });
          status = "running";

          void pollingPromise.then(
            () => {
              pollingStarted = false;
              if (status === "running") status = "configured";
            },
            (error: unknown) => {
              pollingStarted = false;
              status = "error";
              console.error(
                `[telegram] polling failed: ${safeErrorMessage(error)}`
              );
            }
          );
        } catch (error) {
          status = "error";
          console.error(
            `[telegram] initialization failed: ${safeErrorMessage(error)}`
          );
        } finally {
          activationPromise = null;
        }
      })();

      return activationPromise;
    },

    async stop(): Promise<void> {
      if (!bot) {
        status = token ? "error" : "disabled";
        return;
      }

      if (pollingStarted) {
        await bot.stop();
        await pollingPromise?.catch(() => undefined);
        pollingStarted = false;
      }

      status = "configured";
    }
  };
}
