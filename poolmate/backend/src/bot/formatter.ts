import type { BotStatus } from "@poolmate/shared";
import type { AgentRuntimeStatus } from "../agent/agentRuntime.js";

export interface PoolMateStatusView {
  bot: BotStatus;
  agent?: AgentRuntimeStatus;
}

export function formatPoolMateStatus(view: PoolMateStatusView): string {
  const lines = ["PoolMate status", `Bot: ${view.bot}`];

  if (view.agent) {
    lines.push(
      `Agent: ${view.agent.state}`,
      `Agent mode: ${view.agent.activeMode ?? view.agent.lastMode ?? "none"}`
    );
  }

  return lines.join("\n");
}
