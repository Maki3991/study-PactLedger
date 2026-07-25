import type { BotStatus } from "@poolmate/shared";

export interface BotAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): BotStatus;
  sendMessage(chatId: string, text: string): Promise<boolean>;
}
