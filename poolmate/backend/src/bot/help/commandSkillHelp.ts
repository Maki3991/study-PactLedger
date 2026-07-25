import type { PoolMateHelpSkill } from "./poolMateHelpCatalog.js";
import {
  POOLMATE_HELP_SKILLS,
  findPoolMateHelpSkill
} from "./poolMateHelpCatalog.js";
import type { CommandSkillInvoker } from "./commandSkillInvoker.js";

export function helpCommandPayload(text: string): string {
  return text
    .replace(/^\/(?:pool_help|help)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i, "")
    .trim();
}

export function formatGeneralHelp(): string {
  return [
    "PoolMate help",
    "Use natural language by mentioning @PoolMate, or use commands directly.",
    "",
    ...POOLMATE_HELP_SKILLS.map(
      (skill) => `${skill.command}\n${skill.description}`
    ),
    "",
    "Ask /pool_help <what you want to do> and PoolMate will call the matching command skill."
  ].join("\n");
}

export function formatSkillHelp(
  skill: PoolMateHelpSkill,
  source: "llm" | "keyword" | "natural_language"
): string {
  return [
    `Command skill called (${source}):`,
    skill.command,
    "",
    skill.description,
    `Examples: ${skill.examples.join(" | ")}`
  ].join("\n");
}

export function keywordHelpSkill(text: string): PoolMateHelpSkill | undefined {
  const normalized = text.toLowerCase();
  let bestSkill: PoolMateHelpSkill | undefined;
  let bestScore = 0;
  for (const skill of POOLMATE_HELP_SKILLS) {
    const score = skill.keywords.filter((keyword) =>
      normalized.includes(keyword.toLowerCase())
    ).length;
    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill;
    }
  }
  return bestSkill;
}

export async function invokeCommandSkill(
  invoker: CommandSkillInvoker | undefined,
  input: {
    text: string;
    locale?: string;
    surface: "telegram_command" | "telegram_mention";
  }
): Promise<PoolMateHelpSkill | undefined> {
  if (!invoker || invoker.getStatus() === "disabled") return undefined;
  const result = await invoker.invoke(input);
  return result.confidence >= 0.6 && result.skillId !== "unknown"
    ? findPoolMateHelpSkill(result.skillId)
    : undefined;
}
