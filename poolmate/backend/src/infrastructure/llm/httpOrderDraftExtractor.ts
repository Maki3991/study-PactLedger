import { request as undiciRequest } from "undici";
import { z } from "zod";
import type { LlmStatus } from "@poolmate/shared";
import {
  ORDER_DRAFT_FIELDS,
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
    targetUnits: z.number().int().min(1).max(1_000).nullable(),
    missingFields: z.array(draftFieldSchema).max(2),
    ambiguousFields: z.array(draftFieldSchema).max(2)
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
    for (const field of ORDER_DRAFT_FIELDS) {
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
  });

const structuredOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"], minLength: 1, maxLength: 120 },
    targetUnits: {
      type: ["integer", "null"],
      minimum: 1,
      maximum: 1_000
    },
    missingFields: {
      type: "array",
      items: { type: "string", enum: [...ORDER_DRAFT_FIELDS] },
      maxItems: 2
    },
    ambiguousFields: {
      type: "array",
      items: { type: "string", enum: [...ORDER_DRAFT_FIELDS] },
      maxItems: 2
    }
  },
  required: ["title", "targetUnits", "missingFields", "ambiguousFields"]
} as const;

const EXTRACTION_INSTRUCTIONS = [
  "Extract only a PoolMate order draft from the user's Telegram message.",
  "The title is a short product or pool description, not a price or payee.",
  "targetUnits is the total positive integer quantity requested.",
  "If a field is absent, set it to null and list it in missingFields.",
  "If a field has multiple plausible values, set it to null and list it in ambiguousFields.",
  "Do not infer merchant, asset, amount, allocation, payee, confirmation, payment, or order state."
].join(" ");

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
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxInputChars: number;
  private readonly transport: OrderDraftHttpTransport;
  private status: LlmStatus = "configured";

  constructor(
    options: CreateOrderDraftExtractorOptions & {
      baseUrl: string;
      apiKey: string;
      model: string;
    }
  ) {
    this.url = responsesUrl(options.baseUrl);
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
    try {
      const response = await this.send({
        url: this.url,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
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
          max_output_tokens: 300
        }),
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
      this.status = "unavailable";
      if (error instanceof OrderDraftExtractorError) throw error;
      throw unavailable("The LLM draft extractor is unavailable.");
    }
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
    baseUrl,
    apiKey,
    model
  });
}

function responsesUrl(value: string): URL {
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
    base.hash ||
    base.pathname !== "/"
  ) {
    throw unavailable("The LLM base URL must be a secure HTTPS origin.");
  }
  return new URL("/v1/responses", base);
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
  const timeout = value ?? 10_000;
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
