import { request as undiciRequest } from "undici";
import { z } from "zod";
import type { LlmStatus } from "@poolmate/shared";
import {
  ORDER_DRAFT_FIELDS,
  ORDER_DRAFT_REQUIRED_FIELDS,
  type ExtractOrderDraftRequest,
  type OrderDraftExtraction,
  type OrderDraftExtractor,
  OrderDraftExtractorError
} from "../../application/ports/orderDraftExtractor.js";

const MAX_RESPONSE_BYTES = 64 * 1024;

const draftFieldSchema = z.enum(ORDER_DRAFT_FIELDS);
const draftExtractionSchema = z
  .object({
    title: z.string().trim().min(1).max(120).nullable(),
    itemName: z.string().trim().min(1).max(120).nullable(),
    targetUnits: z.number().int().min(1).max(1_000).nullable(),
    unit: z.string().trim().min(1).max(24).nullable(),
    purchaseChannelHint: z.string().trim().min(1).max(80).nullable(),
    userPriceHint: z.string().trim().min(1).max(80).nullable(),
    missingFields: z
      .array(z.enum(ORDER_DRAFT_REQUIRED_FIELDS))
      .max(ORDER_DRAFT_REQUIRED_FIELDS.length),
    ambiguousFields: z.array(draftFieldSchema).max(ORDER_DRAFT_FIELDS.length)
  })
  .strict()
  .superRefine((value, context) => {
    const missing = new Set(value.missingFields);
    const ambiguous = new Set(value.ambiguousFields);
    if (
      missing.size !== value.missingFields.length ||
      ambiguous.size !== value.ambiguousFields.length ||
      [...missing].some((field) => ambiguous.has(field))
    ) {
      context.addIssue({
        code: "custom",
        message: "Draft field classifications must be unique and disjoint."
      });
    }
    for (const field of ORDER_DRAFT_REQUIRED_FIELDS) {
      const hasValue = value[field] !== null;
      const classified = missing.has(field) || ambiguous.has(field);
      if (hasValue === classified) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Each draft field must be either resolved or classified."
        });
      }
    }
    for (const field of ORDER_DRAFT_FIELDS) {
      if (ambiguous.has(field) && value[field] !== null) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Ambiguous draft fields must not contain a value."
        });
      }
    }
  });

const structuredOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"], minLength: 1, maxLength: 120 },
    itemName: { type: ["string", "null"], minLength: 1, maxLength: 120 },
    targetUnits: {
      type: ["integer", "null"],
      minimum: 1,
      maximum: 1_000
    },
    unit: { type: ["string", "null"], minLength: 1, maxLength: 24 },
    purchaseChannelHint: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 80
    },
    userPriceHint: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 80
    },
    missingFields: {
      type: "array",
      items: { type: "string", enum: [...ORDER_DRAFT_REQUIRED_FIELDS] },
      maxItems: ORDER_DRAFT_REQUIRED_FIELDS.length
    },
    ambiguousFields: {
      type: "array",
      items: { type: "string", enum: [...ORDER_DRAFT_FIELDS] },
      maxItems: ORDER_DRAFT_FIELDS.length
    }
  },
  required: [
    "title",
    "itemName",
    "targetUnits",
    "unit",
    "purchaseChannelHint",
    "userPriceHint",
    "missingFields",
    "ambiguousFields"
  ]
} as const;

const EXTRACTION_INSTRUCTIONS = [
  "Extract one PoolMate single-item group-purchase draft from the user's Telegram message.",
  "The title is a short group-purchase title and itemName is the requested product.",
  "targetUnits is the explicitly requested total positive integer quantity.",
  "unit is the explicitly stated quantity unit such as 瓶, 箱, 杯, 份, or null when omitted.",
  "purchaseChannelHint preserves an explicitly stated shopping channel such as 美团外卖, 饿了么, 京东到家, 盒马, or null when omitted.",
  "A purchase channel hint is untrusted user intent, never a verified merchant identity or payee.",
  "userPriceHint preserves only an explicitly stated reference-price phrase such as 一箱89 or 45元一份; otherwise it is null.",
  "If multiple different products are requested, mark itemName ambiguous instead of inventing a cart.",
  "If a field is absent, set it to null and list it in missingFields.",
  "If a field has multiple plausible values, set it to null and list it in ambiguousFields.",
  "Optional unit, purchaseChannelHint, and userPriceHint may be null without being listed as missing.",
  "Do not infer a verified merchant, merchantId, asset, final amount, allocation, payee, confirmation, payment, or order state.",
  "Example: @PoolMate 拼单 3瓶可乐，美团外卖 => title 可乐拼单, itemName 可乐, targetUnits 3, unit 瓶, purchaseChannelHint 美团外卖, userPriceHint null."
].join(" ");

export type OrderDraftLlmProvider = "deepseek" | "responses";

export interface OrderDraftHttpTransportRequest {
  url: URL;
  headers: Readonly<Record<string, string>>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface OrderDraftHttpTransportResponse {
  status: number;
  body: string;
}

export interface OrderDraftHttpTransport {
  send(
    request: OrderDraftHttpTransportRequest
  ): Promise<OrderDraftHttpTransportResponse>;
}

export interface CreateOrderDraftExtractorOptions {
  enabled: boolean;
  provider?: OrderDraftLlmProvider;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxInputChars?: number;
  transport?: OrderDraftHttpTransport;
}

class UndiciOrderDraftTransport implements OrderDraftHttpTransport {
  async send(
    request: OrderDraftHttpTransportRequest
  ): Promise<OrderDraftHttpTransportResponse> {
    const response = await undiciRequest(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      headersTimeout: request.timeoutMs,
      bodyTimeout: request.timeoutMs,
      signal: request.signal
    });
    const declaredLength = Number(response.headers["content-length"]);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      response.body.destroy();
      throw unavailable("The LLM response was too large.");
    }
    const body = await response.body.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
      throw unavailable("The LLM response was too large.");
    }
    return { status: response.statusCode, body };
  }
}

export const undiciOrderDraftTransport: OrderDraftHttpTransport =
  new UndiciOrderDraftTransport();

class DisabledOrderDraftExtractor implements OrderDraftExtractor {
  getStatus(): LlmStatus {
    return "disabled";
  }

  async extract(): Promise<OrderDraftExtraction> {
    throw new OrderDraftExtractorError(
      "LLM_DISABLED",
      "Natural-language order drafts are disabled."
    );
  }
}

class HttpOrderDraftExtractor implements OrderDraftExtractor {
  private readonly url: URL;
  private readonly provider: OrderDraftLlmProvider;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxInputChars: number;
  private readonly transport: OrderDraftHttpTransport;
  private status: LlmStatus = "configured";

  constructor(
    options: CreateOrderDraftExtractorOptions & {
      provider: OrderDraftLlmProvider;
      baseUrl: string;
      apiKey: string;
      model: string;
    }
  ) {
    this.provider = options.provider;
    this.url =
      options.provider === "deepseek"
        ? chatCompletionsUrl(options.baseUrl)
        : responsesUrl(options.baseUrl);
    this.apiKey = requireHeaderValue(options.apiKey, "LLM API key");
    this.model = requireText(options.model, "LLM model", 120);
    this.timeoutMs = validateTimeout(options.timeoutMs);
    this.maxInputChars = validateMaxInput(options.maxInputChars);
    this.transport = options.transport ?? undiciOrderDraftTransport;
  }

  getStatus(): LlmStatus {
    return this.status;
  }

  async extract(
    request: ExtractOrderDraftRequest
  ): Promise<OrderDraftExtraction> {
    const text = request.text.trim();
    if (!text || text.length > this.maxInputChars) {
      throw new OrderDraftExtractorError(
        "LLM_INVALID_INPUT",
        `Natural-language order requests must contain 1-${this.maxInputChars} characters.`
      );
    }
    const attempts = this.provider === "deepseek" ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.send({
          url: this.url,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(
            this.provider === "deepseek"
              ? {
                  model: this.model,
                  messages: [
                    {
                      role: "system",
                      content: `${EXTRACTION_INSTRUCTIONS} Return only one JSON object matching this schema: ${JSON.stringify(structuredOutputSchema)}.`
                    },
                    {
                      role: "user",
                      content: request.locale
                        ? `[locale=${request.locale}] ${text}`
                        : text
                    }
                  ],
                  response_format: { type: "json_object" },
                  temperature: 0,
                  max_tokens: 1_000,
                  stream: false
                }
              : {
                  model: this.model,
                  instructions: EXTRACTION_INSTRUCTIONS,
                  input: [
                    {
                      role: "user",
                      content: [
                        {
                          type: "input_text",
                          text: request.locale
                            ? `[locale=${request.locale}] ${text}`
                            : text
                        }
                      ]
                    }
                  ],
                  text: {
                    format: {
                      type: "json_schema",
                      name: "poolmate_order_draft_patch",
                      strict: true,
                      schema: structuredOutputSchema
                    }
                  },
                  max_output_tokens: 500
                }
          ),
          timeoutMs: this.timeoutMs,
          signal: request.signal
        });
        if (response.status < 200 || response.status >= 300) {
          throw unavailable("The LLM endpoint rejected the draft request.");
        }
        const extraction = decodeResponse(response.body);
        this.status = "configured";
        return extraction;
      } catch (error) {
        if (
          error instanceof OrderDraftExtractorError &&
          error.code === "LLM_INVALID_INPUT"
        ) {
          throw error;
        }
        const retryableInvalidResponse =
          error instanceof OrderDraftExtractorError &&
          error.code === "LLM_INVALID_RESPONSE" &&
          attempt < attempts;
        if (retryableInvalidResponse) continue;
        this.status = "unavailable";
        if (error instanceof OrderDraftExtractorError) throw error;
        throw unavailable("The LLM draft extractor is unavailable.");
      }
    }
    throw unavailable("The LLM draft extractor is unavailable.");
  }

  private async send(
    request: OrderDraftHttpTransportRequest
  ): Promise<OrderDraftHttpTransportResponse> {
    let timeout: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    try {
      return await Promise.race([
        this.transport.send({ ...request, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(unavailable("The LLM draft request timed out."));
          }, request.timeoutMs);
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createOrderDraftExtractor(
  options: CreateOrderDraftExtractorOptions
): OrderDraftExtractor {
  if (!options.enabled) return new DisabledOrderDraftExtractor();
  const baseUrl = options.baseUrl?.trim();
  const apiKey = options.apiKey?.trim();
  const model = options.model?.trim();
  if (!baseUrl || !apiKey || !model) {
    throw unavailable("The enabled LLM draft extractor is not configured.");
  }
  return new HttpOrderDraftExtractor({
    ...options,
    provider: options.provider ?? "responses",
    baseUrl,
    apiKey,
    model
  });
}

function chatCompletionsUrl(value: string): URL {
  return new URL("chat/completions", secureBaseUrl(value));
}

function responsesUrl(value: string): URL {
  const base = secureBaseUrl(value);
  return new URL(base.pathname === "/" ? "v1/responses" : "responses", base);
}

function secureBaseUrl(value: string): URL {
  let base: URL;
  try {
    base = new URL(value);
  } catch {
    throw unavailable("The LLM base URL is invalid.");
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw unavailable(
      "The LLM base URL must use HTTPS without credentials, query, or fragment."
    );
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

function requireText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw unavailable(`${field} is invalid.`);
  }
  return normalized;
}

function requireHeaderValue(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw unavailable(`${field} is invalid.`);
  }
  return normalized;
}

function validateTimeout(value: number | undefined): number {
  const timeout = value ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000) {
    throw unavailable("The LLM timeout is invalid.");
  }
  return timeout;
}

function validateMaxInput(value: number | undefined): number {
  const maxInput = value ?? 2_000;
  if (!Number.isInteger(maxInput) || maxInput < 200 || maxInput > 8_000) {
    throw unavailable("The LLM input limit is invalid.");
  }
  return maxInput;
}

function decodeResponse(body: string): OrderDraftExtraction {
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw invalidResponse("The LLM response was too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalidResponse("The LLM returned invalid JSON.");
  }
  if (!isRecord(value)) {
    throw invalidResponse("The LLM response envelope is invalid.");
  }
  const text = responseOutputText(value);
  let draft: unknown;
  try {
    draft = JSON.parse(text);
  } catch {
    throw invalidResponse("The LLM structured output was not valid JSON.");
  }
  const parsed = draftExtractionSchema.safeParse(draft);
  if (!parsed.success) {
    throw invalidResponse(
      "The LLM structured output violated the draft schema."
    );
  }
  return parsed.data;
}

function responseOutputText(value: Record<string, unknown>): string {
  if (Array.isArray(value.choices)) {
    const texts = value.choices
      .map((choice) => {
        if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
        return typeof choice.message.content === "string"
          ? choice.message.content
          : undefined;
      })
      .filter((text): text is string => Boolean(text?.trim()));
    if (texts.length === 1) return texts[0]!;
    throw invalidResponse(
      "The LLM chat completion did not contain one structured output."
    );
  }
  if (typeof value.output_text === "string" && value.output_text.trim()) {
    return value.output_text;
  }
  if (!Array.isArray(value.output)) {
    throw invalidResponse("The LLM response did not contain output.");
  }
  const texts: string[] = [];
  for (const output of value.output) {
    if (!isRecord(output) || output.type !== "message") continue;
    if (!Array.isArray(output.content)) continue;
    for (const content of output.content) {
      if (!isRecord(content)) continue;
      if (content.type === "refusal") {
        throw new OrderDraftExtractorError(
          "LLM_REFUSED",
          "The LLM refused to parse this order request."
        );
      }
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }
  if (texts.length !== 1 || !texts[0]!.trim()) {
    throw invalidResponse(
      "The LLM response did not contain one structured output."
    );
  }
  return texts[0]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable(message: string): OrderDraftExtractorError {
  return new OrderDraftExtractorError("LLM_UNAVAILABLE", message);
}

function invalidResponse(message: string): OrderDraftExtractorError {
  return new OrderDraftExtractorError("LLM_INVALID_RESPONSE", message);
}
