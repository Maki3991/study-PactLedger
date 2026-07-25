import type { LlmStatus } from "@poolmate/shared";
import type { PoolMateHelpSkillId } from "./poolMateHelpCatalog.js";

export interface CommandSkillCall {
  skillId: PoolMateHelpSkillId | "unknown";
  confidence: number;
  reason?: string;
}

export interface InvokeCommandSkillInput {
  text: string;
  locale?: string;
  surface?: "telegram_command" | "telegram_mention";
  signal?: AbortSignal;
}

export interface CommandSkillInvoker {
  invoke(input: InvokeCommandSkillInput): Promise<CommandSkillCall>;
  getStatus(): LlmStatus;
}

export class CommandSkillInvokerError extends Error {
  constructor(
    readonly code:
      | "LLM_DISABLED"
      | "LLM_INVALID_INPUT"
      | "LLM_UNAVAILABLE"
      | "LLM_REFUSED"
      | "LLM_INVALID_RESPONSE",
    message: string
  ) {
    super(message);
    this.name = "CommandSkillInvokerError";
  }
}
