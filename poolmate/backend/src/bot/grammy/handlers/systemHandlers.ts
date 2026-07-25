import type { Bot } from "grammy";
import type { BotStatus } from "@poolmate/shared";
import type { AgentRuntimeStatus } from "../../../agent/agentRuntime.js";
import { formatPoolMateStatus } from "../../formatter.js";
import { message, resolveLocale } from "../../i18n.js";
import type { PoolMateContext } from "../context.js";

export interface SystemHandlerDependencies {
  getBotStatus(): BotStatus;
  getAgentStatus?(): AgentRuntimeStatus;
}

export function registerSystemHandlers(
  bot: Bot<PoolMateContext>,
  dependencies: SystemHandlerDependencies
): void {
  bot.command("start", async (context) => {
    const locale = resolveLocale(context.from?.language_code);
    await context.reply(message(locale, "start"));
  });

  bot.command("status", async (context) => {
    await context.reply(
      formatPoolMateStatus({
        bot: dependencies.getBotStatus(),
        agent: dependencies.getAgentStatus?.()
      })
    );
  });
}
