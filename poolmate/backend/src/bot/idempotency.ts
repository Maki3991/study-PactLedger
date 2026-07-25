export function telegramUpdateIdempotencyKey(updateId: number): string {
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error("Telegram update id must be a non-negative integer.");
  }
  return `telegram:update:v1:${updateId}`;
}

export function telegramCallbackIdempotencyKey(
  callbackQueryId: string
): string {
  const normalized = callbackQueryId.trim();
  if (!normalized) {
    throw new Error("Telegram callback query id is required.");
  }
  return `telegram:callback:v1:${normalized}`;
}
