import type { PoolMateHelpSkill } from "./poolMateHelpCatalog.js";
import {
  POOLMATE_HELP_SKILLS,
  findPoolMateHelpSkill
} from "./poolMateHelpCatalog.js";
import type { CommandSkillInvoker } from "./commandSkillInvoker.js";
import { CommandSkillInvokerError } from "./commandSkillInvoker.js";

export function helpCommandPayload(text: string): string {
  return text
    .replace(/^\/(?:pool_help|help)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i, "")
    .trim();
}

export function formatGeneralHelp(): string {
  const regular = POOLMATE_HELP_SKILLS.filter((skill) => !skill.debug);
  const debug = POOLMATE_HELP_SKILLS.filter((skill) => skill.debug);
  const formatSkill = (skill: PoolMateHelpSkill): string =>
    `${skill.command}\n${skill.description}`;
  return [
    "PoolMate help",
    "Use natural language by mentioning @PoolMate, or use commands directly.",
    "",
    regular.map(formatSkill).join("\n\n"),
    ...(debug.length > 0
      ? [
          "",
          "Debug commands (demo only):",
          "",
          debug.map(formatSkill).join("\n\n")
        ]
      : []),
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
    "",
    "Examples:",
    ...skill.examples.map((example) => `- ${example}`)
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
  if (!invoker || invoker.getStatus() === "disabled") {
    throw new CommandSkillInvokerError(
      "LLM_DISABLED",
      "LLM command skill invocation is disabled."
    );
  }
  const result = await invoker.invoke(input);
  console.info("[poolmate] command skill invocation", {
    surface: input.surface,
    skillId: result.skillId,
    confidence: result.confidence
  });
  return result.skillId === "unknown"
    ? undefined
    : findPoolMateHelpSkill(result.skillId);
}
