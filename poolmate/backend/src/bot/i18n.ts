export const SUPPORTED_LOCALES = ["en", "zh"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type MessageKey = "start" | "unavailable";

const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  en: {
    start: "PoolMate is ready. Use /status to check the bot and agent runtime.",
    unavailable: "PoolMate could not process this request."
  },
  zh: {
    start: "PoolMate 已就绪。使用 /status 查看 Bot 和 Agent 运行状态。",
    unavailable: "PoolMate 暂时无法处理此请求。"
  }
};

export function resolveLocale(languageCode?: string): Locale {
  return String(languageCode || "")
    .toLowerCase()
    .startsWith("zh")
    ? "zh"
    : "en";
}

export function message(locale: Locale, key: MessageKey): string {
  return MESSAGES[locale][key];
}
