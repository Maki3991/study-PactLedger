import { z } from "zod";
import type { OrderIntentSource, OrderIntentView } from "@poolmate/shared";

export const ORDER_INTENT_SCHEMA_VERSION = "poolmate-order-intent-v1" as const;

const safeText = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine(
      (value) =>
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        }),
      "Text contains control characters."
    );

const orderIntentSchema = z
  .object({
    schemaVersion: z.literal(ORDER_INTENT_SCHEMA_VERSION),
    originalText: safeText(2_000),
    source: z.enum([
      "telegram_natural_language",
      "telegram_command",
      "admin"
    ] satisfies OrderIntentSource[]),
    items: z
      .array(
        z
          .object({
            name: safeText(120),
            quantity: z.number().int().min(1).max(1_000),
            unit: safeText(24).optional()
          })
          .strict()
      )
      .length(1),
    purchaseChannelHint: safeText(80).optional(),
    storeNameHint: safeText(120).optional(),
    merchantLinkHint: safeText(512).optional(),
    userPriceHint: safeText(80).optional()
  })
  .strict();

export function fallbackOrderIntent(
  title: string,
  targetUnits: number,
  source: OrderIntentSource = "admin",
  originalText = title
): OrderIntentView {
  return {
    schemaVersion: ORDER_INTENT_SCHEMA_VERSION,
    originalText,
    source,
    items: [{ name: title, quantity: targetUnits }]
  };
}

export function normalizeOrderIntent(
  value: OrderIntentView | undefined,
  fallback: {
    title: string;
    targetUnits: number;
    source?: OrderIntentSource;
    originalText?: string;
  }
): OrderIntentView {
  const parsed = orderIntentSchema.parse(
    value ??
      fallbackOrderIntent(
        fallback.title,
        fallback.targetUnits,
        fallback.source,
        fallback.originalText
      )
  );
  if (parsed.items[0]!.quantity !== fallback.targetUnits) {
    throw new Error("Order intent quantity must match targetUnits.");
  }
  return parsed;
}

export function serializeOrderIntent(value: OrderIntentView): string {
  return JSON.stringify(orderIntentSchema.parse(value));
}

export function parsePersistedOrderIntent(
  schemaVersion: string | null,
  json: string | null,
  fallback: { title: string; targetUnits: number }
): OrderIntentView {
  if (schemaVersion === ORDER_INTENT_SCHEMA_VERSION && json) {
    try {
      return orderIntentSchema.parse(JSON.parse(json));
    } catch {
      // Legacy or corrupted optional intent metadata must not hide the order.
    }
  }
  return fallbackOrderIntent(fallback.title, fallback.targetUnits);
}
