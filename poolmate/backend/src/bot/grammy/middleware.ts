import type { MiddlewareFn } from "grammy";
import type { PoolMateContext } from "./context.js";

export function createAccessMiddleware(
  allowedUserIds: ReadonlyArray<string | number>
): MiddlewareFn<PoolMateContext> {
  const allowed = new Set(allowedUserIds.map(String));

  return async (context, next) => {
    const userId = context.from?.id ?? context.callbackQuery?.from.id;
    if (userId === undefined || !allowed.has(String(userId))) {
      return;
    }

    await next();
  };
}
