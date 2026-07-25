import type { Bot } from "grammy";
import type { BotStatus, LlmStatus } from "@poolmate/shared";
import { formatPoolMateStatus } from "../../formatter.js";
import { message, resolveLocale } from "../../i18n.js";
import {
  formatGeneralHelp,
  formatSkillHelp,
  helpCommandPayload,
  invokeCommandSkill,
  keywordHelpSkill
} from "../../help/commandSkillHelp.js";
import type { CommandSkillInvoker } from "../../help/commandSkillInvoker.js";
import type { PoolMateContext } from "../context.js";

export interface SystemHandlerDependencies {
  getBotStatus(): BotStatus;
  getLlmStatus(): LlmStatus;
  commandSkillInvoker?: CommandSkillInvoker;
}

async function replyWithHelp(
  context: PoolMateContext,
  invoker?: CommandSkillInvoker
): Promise<void> {
  const query = helpCommandPayload(context.message?.text ?? "");
  if (!query) {
    await context.reply(formatGeneralHelp());
    return;
  }

  try {
    const skill = await invokeCommandSkill(invoker, {
      text: query,
      locale: context.from?.language_code,
      surface: "telegram_command"
    });
    if (skill) {
      await context.reply(formatSkillHelp(skill, "llm"));
      return;
    }
  } catch {
    // Fall through to local keyword help. Help must remain available offline.
  }

  const skill = keywordHelpSkill(query);
  if (skill) {
    await context.reply(formatSkillHelp(skill, "keyword"));
    return;
  }

  await context.reply(
    [
      "I could not match that request to a PoolMate command.",
      "Try /pool_help with words like create, claim, quote, status, close, remind, or virtual."
    ].join("\n")
  );
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

  bot.command("help", async (context) => {
    await replyWithHelp(context, dependencies.commandSkillInvoker);
  });

  bot.command("pool_help", async (context) => {
    await replyWithHelp(context, dependencies.commandSkillInvoker);
  });
}
