import type { Bot } from "grammy";
import type { BotStatus, LlmStatus } from "@poolmate/shared";
import { formatPoolMateStatus } from "../../formatter.js";
import { message, resolveLocale } from "../../i18n.js";
import type { PoolMateContext } from "../context.js";

export interface SystemHandlerDependencies {
  getBotStatus(): BotStatus;
  getLlmStatus(): LlmStatus;
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
        llm: dependencies.getLlmStatus()
      })
    );
  });
}
