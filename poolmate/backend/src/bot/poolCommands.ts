const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_TARGET_UNITS = 1_000;
const MAX_TEST_DELTA = 20;
const MAX_TITLE_LENGTH = 120;

export interface NewPoolCommand {
  targetUnits: number;
  title: string;
}

export interface OrderUnitsCommand {
  orderId: string;
  units: number;
}

export interface PoolTestCommand {
  orderId: string;
  delta: number;
}

function commandPayload(text: string, command: string): string {
  return text
    .replace(new RegExp(`^/${command}(?:@[A-Za-z0-9_]+)?(?:\\s+|$)`, "i"), "")
    .trim();
}

function positiveUnits(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const units = Number(raw);
  return Number.isSafeInteger(units) && units > 0 && units <= MAX_TARGET_UNITS
    ? units
    : null;
}

export function validOrderId(orderId: string): boolean {
  return ORDER_ID_PATTERN.test(orderId);
}

export function parseNewPoolCommand(text: string): NewPoolCommand | null {
  const payload = commandPayload(text, "pool_new");
  const match = /^(\d+)\s+(.+)$/.exec(payload);
  if (!match) return null;

  const units = positiveUnits(match[1]);
  const title = match[2].trim();
  if (!units || !title || title.length > MAX_TITLE_LENGTH) return null;
  return { targetUnits: units, title };
}

export function parseOrderUnitsCommand(
  text: string,
  command = "pool_claim"
): OrderUnitsCommand | null {
  const payload = commandPayload(text, command);
  const match = /^(\S+)(?:\s+(\d+))?$/.exec(payload);
  if (!match || !validOrderId(match[1])) return null;

  const units = positiveUnits(match[2] ?? "1");
  return units ? { orderId: match[1], units } : null;
}

export function parseOrderCommand(
  text: string,
  command:
    | "pool_leave"
    | "pool_close"
    | "pool_quote"
    | "pool_remind"
    | "pool_status"
): string | null {
  const payload = commandPayload(text, command);
  return validOrderId(payload) ? payload : null;
}

export function parsePoolTestCommand(text: string): PoolTestCommand | null {
  const payload = commandPayload(text, "pool_test");
  const match = /^(\S+)\s+(?:(add|remove)\s+)?([+-]?\d+)$/i.exec(payload);
  if (!match || !validOrderId(match[1])) return null;

  const verb = match[2]?.toLowerCase();
  const rawDelta = Number(match[3]);
  if (!Number.isSafeInteger(rawDelta) || rawDelta === 0) return null;
  const delta =
    verb === "add"
      ? Math.abs(rawDelta)
      : verb === "remove"
        ? -Math.abs(rawDelta)
        : rawDelta;
  if (Math.abs(delta) > MAX_TEST_DELTA) return null;
  return { orderId: match[1], delta };
}
