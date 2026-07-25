import type { LlmStatus } from "@poolmate/shared";

export const ORDER_DRAFT_REQUIRED_FIELDS = [
  "title",
  "itemName",
  "targetUnits"
] as const;

export const ORDER_DRAFT_OPTIONAL_FIELDS = [
  "unit",
  "purchaseChannelHint",
  "userPriceHint"
] as const;

export const ORDER_DRAFT_FIELDS = [
  ...ORDER_DRAFT_REQUIRED_FIELDS,
  ...ORDER_DRAFT_OPTIONAL_FIELDS
] as const;

export type OrderDraftField = (typeof ORDER_DRAFT_FIELDS)[number];

export interface OrderDraftExtraction {
  title: string | null;
  itemName: string | null;
  targetUnits: number | null;
  unit: string | null;
  purchaseChannelHint: string | null;
  userPriceHint: string | null;
  missingFields: Array<(typeof ORDER_DRAFT_REQUIRED_FIELDS)[number]>;
  ambiguousFields: OrderDraftField[];
}

export interface ExtractOrderDraftRequest {
  text: string;
  locale?: string;
  signal?: AbortSignal;
}

export interface OrderDraftExtractor {
  extract(request: ExtractOrderDraftRequest): Promise<OrderDraftExtraction>;
  getStatus(): LlmStatus;
}

export class OrderDraftExtractorError extends Error {
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
    this.name = "OrderDraftExtractorError";
  }
}
