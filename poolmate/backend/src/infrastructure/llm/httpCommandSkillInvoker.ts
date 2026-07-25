import type { LlmStatus } from "@poolmate/shared";
import {
  POOLMATE_HELP_SKILL_IDS,
  POOLMATE_HELP_SKILL_MARKDOWN,
  findPoolMateHelpSkill,
  type PoolMateHelpSkillId
} from "../../bot/help/poolMateHelpCatalog.js";
import {
  type CommandSkillCall,
  type CommandSkillInvoker,
  CommandSkillInvokerError,
  type InvokeCommandSkillInput
} from "../../bot/help/commandSkillInvoker.js";
import {
  type OrderDraftHttpTransport,
  type OrderDraftLlmProvider,
  undiciOrderDraftTransport
} from "./httpOrderDraftExtractor.js";

const MAX_RESPONSE_BYTES = 32 * 1024;

const COMMAND_SKILL_INVOKER_INSTRUCTIONS = [
  "Use the following Markdown skill as the authoritative PoolMate command guide.",
  "Choose exactly one Command Skill to call for the user's natural-language request.",
  "Return unknown when no command skill should be called.",
  "Do not execute commands, create orders, create checkouts, create payments, infer payees, or invent order IDs.",
  "Return compact JSON only: skillId, confidence, and optional reason.",
  "",
  POOLMATE_HELP_SKILL_MARKDOWN
].join("\n");

const structuredOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    skillId: {
      type: "string",
      enum: [...POOLMATE_HELP_SKILL_IDS, "unknown"]
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    reason: {
      type: ["string", "null"],
      maxLength: 160
    }
  },
  required: ["skillId", "confidence", "reason"]
} as const;

export interface CreateCommandSkillInvokerOptions {
  enabled: boolean;
  provider?: OrderDraftLlmProvider;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxInputChars?: number;
  transport?: OrderDraftHttpTransport;
}

class DisabledCommandSkillInvoker implements CommandSkillInvoker {
  getStatus(): LlmStatus {
    return "disabled";
  }

  async invoke(): Promise<CommandSkillCall> {
    throw new CommandSkillInvokerError(
      "LLM_DISABLED",
      "LLM command skill invocation is disabled."
    );
  }
}

class HttpCommandSkillInvoker implements CommandSkillInvoker {
  private readonly url: URL;
  private readonly provider: OrderDraftLlmProvider;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxInputChars: number;
  private readonly transport: OrderDraftHttpTransport;
  private status: LlmStatus = "configured";

  constructor(
    options: CreateCommandSkillInvokerOptions & {
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

  async invoke(input: InvokeCommandSkillInput): Promise<CommandSkillCall> {
    const text = input.text.trim();
    if (!text || text.length > this.maxInputChars) {
      throw new CommandSkillInvokerError(
        "LLM_INVALID_INPUT",
        `Command skill requests must contain 1-${this.maxInputChars} characters.`
      );
    }

    try {
      const response = await this.withTimeout(
        this.transport.send({
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
                      content: COMMAND_SKILL_INVOKER_INSTRUCTIONS
                    },
                    {
                      role: "user",
                      content: requestContent(text, input.locale, input.surface)
                    }
                  ],
                  temperature: 0,
                  max_tokens: 300,
                  response_format: { type: "json_object" }
                }
              : {
                  model: this.model,
                  input: [
                    {
                      role: "system",
                      content: COMMAND_SKILL_INVOKER_INSTRUCTIONS
                    },
                    {
                      role: "user",
                      content: requestContent(text, input.locale, input.surface)
                    }
                  ],
                  text: {
                    format: {
                      type: "json_schema",
                      name: "poolmate_command_skill_call",
                      strict: true,
                      schema: structuredOutputSchema
                    }
                  },
                  temperature: 0,
                  max_output_tokens: 300
                }
          ),
          timeoutMs: this.timeoutMs,
          signal: input.signal
        })
      );
      if (response.status < 200 || response.status >= 300) {
        throw unavailable("The LLM endpoint rejected the skill call request.");
      }
      const call = decodeResponse(response.body);
      this.status = "configured";
      return call;
    } catch (error) {
      if (
        error instanceof CommandSkillInvokerError &&
        error.code === "LLM_INVALID_INPUT"
      ) {
        throw error;
      }
      if (
        error instanceof CommandSkillInvokerError &&
        (error.code === "LLM_REFUSED" ||
          error.code === "LLM_INVALID_RESPONSE" ||
          error.code === "LLM_UNAVAILABLE")
      ) {
        this.status = "unavailable";
        throw error;
      }
      this.status = "unavailable";
      throw unavailable("The LLM command skill invoker is unavailable.");
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(unavailable("The LLM command skill call timed out.")),
          this.timeoutMs
        );
      })
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}

export function createCommandSkillInvoker(
  options: CreateCommandSkillInvokerOptions
): CommandSkillInvoker {
  if (!options.enabled) return new DisabledCommandSkillInvoker();
  const provider = options.provider ?? "responses";
  if (!options.baseUrl || !options.apiKey || !options.model) {
    throw unavailable(
      "The enabled LLM command skill invoker is not configured."
    );
  }
  return new HttpCommandSkillInvoker({
    ...options,
    provider,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model
  });
}

function requestContent(
  text: string,
  locale: string | undefined,
  surface: InvokeCommandSkillInput["surface"]
): string {
  return [
    `Locale: ${locale || "unknown"}`,
    `Surface: ${surface || "unknown"}`,
    `User request: ${text}`
  ].join("\n");
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

function decodeResponse(body: string): CommandSkillCall {
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
  let call: unknown;
  try {
    call = JSON.parse(text);
  } catch {
    throw invalidResponse("The LLM structured output was not valid JSON.");
  }
  if (!isRecord(call)) {
    throw invalidResponse("The LLM skill call is invalid.");
  }
  const skillId = call.skillId;
  if (
    typeof skillId !== "string" ||
    (skillId !== "unknown" && !findPoolMateHelpSkill(skillId))
  ) {
    throw invalidResponse("The LLM returned an unknown command skill.");
  }
  const confidence = call.confidence;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw invalidResponse("The LLM confidence is invalid.");
  }
  const reason =
    typeof call.reason === "string" &&
    call.reason.trim().length > 0 &&
    call.reason.length <= 160
      ? call.reason.trim()
      : undefined;
  return {
    skillId: skillId as PoolMateHelpSkillId | "unknown",
    confidence,
    ...(reason ? { reason } : {})
  };
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
        throw new CommandSkillInvokerError(
          "LLM_REFUSED",
          "The LLM refused to invoke a command skill for this request."
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

function unavailable(message: string): CommandSkillInvokerError {
  return new CommandSkillInvokerError("LLM_UNAVAILABLE", message);
}

function invalidResponse(message: string): CommandSkillInvokerError {
  return new CommandSkillInvokerError("LLM_INVALID_RESPONSE", message);
}
