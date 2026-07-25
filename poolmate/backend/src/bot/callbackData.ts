import { validOrderId } from "./poolCommands.js";

const CALLBACK_PREFIX = "pm:v1";
const CALLBACK_LIMIT = 64;

export type PoolMateCallbackData =
  | { action: "claim"; orderId: string; units: number }
  | { action: "leave" | "quote" | "close"; orderId: string };

function assertCallbackLength(value: string): string {
  if (Buffer.byteLength(value, "utf8") > CALLBACK_LIMIT) {
    throw new Error("PoolMate callback data exceeds Telegram's limit.");
  }
  return value;
}

function assertOrderId(orderId: string): void {
  if (!validOrderId(orderId)) {
    throw new Error("Order id is not safe for Telegram callback data.");
  }
}

export function claimCallbackData(orderId: string, units = 1): string {
  assertOrderId(orderId);
  if (!Number.isSafeInteger(units) || units <= 0 || units > 1_000) {
    throw new Error("Claim units are invalid.");
  }
  return assertCallbackLength(
    `${CALLBACK_PREFIX}:claim:${orderId}:${String(units)}`
  );
}

export function leaveCallbackData(orderId: string): string {
  assertOrderId(orderId);
  return assertCallbackLength(`${CALLBACK_PREFIX}:leave:${orderId}`);
}

export function quoteCallbackData(orderId: string): string {
  assertOrderId(orderId);
  return assertCallbackLength(`${CALLBACK_PREFIX}:quote:${orderId}`);
}

export function closeCallbackData(orderId: string): string {
  assertOrderId(orderId);
  return assertCallbackLength(`${CALLBACK_PREFIX}:close:${orderId}`);
}

export function parsePoolMateCallbackData(
  value: string
): PoolMateCallbackData | null {
  if (Buffer.byteLength(value, "utf8") > CALLBACK_LIMIT) return null;
  const parts = value.split(":");
  if (parts[0] !== "pm" || parts[1] !== "v1") return null;

  const action = parts[2];
  const orderId = parts[3];
  if (!orderId || !validOrderId(orderId)) return null;

  if (action === "claim" && parts.length === 5) {
    const units = Number(parts[4]);
    return Number.isSafeInteger(units) && units > 0 && units <= 1_000
      ? { action, orderId, units }
      : null;
  }

  if (
    (action === "leave" || action === "quote" || action === "close") &&
    parts.length === 4
  ) {
    return { action, orderId };
  }

  return null;
}
