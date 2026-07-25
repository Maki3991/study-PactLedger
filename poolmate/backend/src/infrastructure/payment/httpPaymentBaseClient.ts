import type { PoolMatePaymentRequest, SettlementMode } from "@poolmate/shared";
import type {
  PaymentBaseClient,
  PaymentBaseOutcome
} from "../../application/ports/paymentBaseClient.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const OPERATION_ID_PLACEHOLDER = "{operationId}";

export interface PaymentBaseEndpointPaths {
  submit: string;
  recover: string;
}

export interface PaymentBaseHttpTransportRequest {
  method: "GET" | "POST";
  url: URL;
  headers: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs: number;
}

export interface PaymentBaseHttpTransportResponse {
  status: number;
  headers?: Readonly<Record<string, string | undefined>>;
  body: string;
}

export interface PaymentBaseHttpTransport {
  send(
    request: PaymentBaseHttpTransportRequest
  ): Promise<PaymentBaseHttpTransportResponse>;
}

export interface CreateHttpPaymentBaseClientOptions {
  url?: string;
  apiKey?: string;
  settlementMode: SettlementMode;
  endpointPaths?: PaymentBaseEndpointPaths;
  timeoutMs?: number;
  transport?: PaymentBaseHttpTransport;
}

export class PaymentBaseClientError extends Error {
  constructor(
    readonly code:
      | "PAYMENT_BASE_UNAVAILABLE"
      | "PAYMENT_APPROVAL_REQUIRED"
      | "PAYMENT_AMOUNT_UNSUPPORTED"
      | "PAYMENT_OPERATION_UNKNOWN"
      | "PAYMENT_RECOVERY_NOT_ALLOWED",
    message: string
  ) {
    super(message);
    this.name = "PaymentBaseClientError";
  }
}

class DisabledPaymentBaseClient implements PaymentBaseClient {
  readonly settlementMode = "disabled" as const;

  async submit(): Promise<PaymentBaseOutcome> {
    throw unavailable("The payment base client is disabled.");
  }

  async recover(): Promise<PaymentBaseOutcome> {
    throw unavailable("The payment base client is disabled.");
  }
}

class FetchPaymentBaseTransport implements PaymentBaseHttpTransport {
  async send(
    request: PaymentBaseHttpTransportRequest
  ): Promise<PaymentBaseHttpTransportResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: controller.signal,
        redirect: "error"
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        throw unknownResult("The payment base response was too large.");
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        throw unknownResult("The payment base response was too large.");
      }
      return {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? undefined
        },
        body
      };
    } catch (error) {
      if (error instanceof PaymentBaseClientError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw unknownResult(
          "The payment base request timed out; its result is unknown."
        );
      }
      throw unknownResult(
        "The payment base transport failed; its result is unknown."
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const fetchPaymentBaseTransport: PaymentBaseHttpTransport =
  new FetchPaymentBaseTransport();

class HttpPaymentBaseClient implements PaymentBaseClient {
  readonly settlementMode: Exclude<SettlementMode, "disabled">;
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly endpointPaths: PaymentBaseEndpointPaths;
  private readonly timeoutMs: number;
  private readonly transport: PaymentBaseHttpTransport;

  constructor(
    options: CreateHttpPaymentBaseClientOptions & {
      url: string;
      apiKey: string;
      settlementMode: Exclude<SettlementMode, "disabled">;
      endpointPaths: PaymentBaseEndpointPaths;
    }
  ) {
    this.baseUrl = parseBaseUrl(options.url);
    if (containsControlCharacter(options.apiKey)) {
      throw unavailable("The payment base API key is invalid.");
    }
    this.apiKey = options.apiKey;
    this.settlementMode = options.settlementMode;
    this.endpointPaths = validateEndpointPaths(options.endpointPaths);
    this.timeoutMs = validateTimeout(options.timeoutMs);
    this.transport = options.transport ?? fetchPaymentBaseTransport;
  }

  async submit(
    request: PoolMatePaymentRequest,
    operationId: string
  ): Promise<PaymentBaseOutcome> {
    const normalizedOperationId = validateOperationId(operationId);
    const response = await this.send({
      method: "POST",
      url: endpointUrl(this.baseUrl, this.endpointPaths.submit),
      headers: this.headers(request.idempotencyKey),
      body: JSON.stringify({
        operationId: normalizedOperationId,
        request: canonicalPaymentRequest(request)
      }),
      timeoutMs: this.timeoutMs
    });
    return decodeResponse(response, this.settlementMode);
  }

  async recover(operationId: string): Promise<PaymentBaseOutcome> {
    const normalizedOperationId = validateOperationId(operationId);
    // Recovery can only read the persisted operation; it never submits payment data.
    const path = this.endpointPaths.recover.replace(
      OPERATION_ID_PLACEHOLDER,
      encodeURIComponent(normalizedOperationId)
    );
    const response = await this.send({
      method: "GET",
      url: endpointUrl(this.baseUrl, path),
      headers: this.headers(),
      timeoutMs: this.timeoutMs
    });
    return decodeResponse(response, this.settlementMode);
  }

  private async send(
    request: PaymentBaseHttpTransportRequest
  ): Promise<PaymentBaseHttpTransportResponse> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.transport.send(request),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                unknownResult(
                  "The payment base request timed out; its result is unknown."
                )
              ),
            request.timeoutMs
          );
        })
      ]);
    } catch (error) {
      if (error instanceof PaymentBaseClientError) throw error;
      throw unknownResult(
        "The payment base transport failed; its result is unknown."
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private headers(idempotencyKey?: string): Readonly<Record<string, string>> {
    return {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      "content-type": "application/json"
    };
  }
}

export function createHttpPaymentBaseClient(
  options: CreateHttpPaymentBaseClientOptions
): PaymentBaseClient {
  const url = options.url?.trim();
  const apiKey = options.apiKey?.trim();
  if (
    options.settlementMode === "disabled" ||
    !url ||
    !apiKey ||
    !options.endpointPaths
  ) {
    // No remote contract is inferred while PactLedger has no published endpoint.
    return new DisabledPaymentBaseClient();
  }
  return new HttpPaymentBaseClient({
    ...options,
    url,
    apiKey,
    settlementMode: options.settlementMode,
    endpointPaths: options.endpointPaths
  });
}

function canonicalPaymentRequest(
  request: PoolMatePaymentRequest
): PoolMatePaymentRequest {
  return {
    id: request.id,
    orderId: request.orderId,
    checkoutId: request.checkoutId,
    checkoutVersion: request.checkoutVersion,
    checkoutHash: request.checkoutHash,
    confirmationSetId: request.confirmationSetId,
    idempotencyKey: request.idempotencyKey,
    payerRef: request.payerRef,
    payeeId: request.payeeId,
    money: {
      assetId: request.money.assetId,
      amountAtomic: request.money.amountAtomic
    },
    expiresAt: request.expiresAt,
    status: request.status,
    createdAt: request.createdAt
  };
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable("The payment base URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw unavailable(
      "The payment base URL must be an HTTPS origin without credentials, query, or fragment."
    );
  }
  return url;
}

function validateEndpointPaths(
  paths: PaymentBaseEndpointPaths
): PaymentBaseEndpointPaths {
  validateEndpointPath(paths.submit, false);
  validateEndpointPath(paths.recover, true);
  return { ...paths };
}

function validateEndpointPath(path: string, recovery: boolean): void {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    throw unavailable("The payment base endpoint path is not allowed.");
  }
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /(^|\/)demo(\/|$)/i.test(decodedPath) ||
    decodedPath
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    throw unavailable("The payment base endpoint path is not allowed.");
  }
  const placeholders = path.split(OPERATION_ID_PLACEHOLDER).length - 1;
  if ((recovery && placeholders !== 1) || (!recovery && placeholders !== 0)) {
    throw unavailable("The payment recovery endpoint path is invalid.");
  }
}

function validateTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000) {
    throw unavailable("The payment base timeout is invalid.");
  }
  return timeout;
}

function validateOperationId(value: string): string {
  const operationId = value.trim();
  if (
    !operationId ||
    operationId.length > 256 ||
    containsControlCharacter(operationId)
  ) {
    throw new PaymentBaseClientError(
      "PAYMENT_RECOVERY_NOT_ALLOWED",
      "The original payment operation ID is invalid."
    );
  }
  return operationId;
}

function endpointUrl(baseUrl: URL, path: string): URL {
  return new URL(path, baseUrl.origin);
}

function decodeResponse(
  response: PaymentBaseHttpTransportResponse,
  expectedMode: Exclude<SettlementMode, "disabled">
): PaymentBaseOutcome {
  if (Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE_BYTES) {
    throw unknownResult("The payment base response was too large.");
  }
  if (response.status === 401 || response.status === 403) {
    throw unavailable("The payment base rejected its server credentials.");
  }
  let body: unknown;
  try {
    body = JSON.parse(response.body) as unknown;
  } catch {
    throw unknownResult("The payment base returned an invalid response.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw normalizedHttpError(body);
  }
  return parseOutcome(body, expectedMode);
}

function parseOutcome(
  value: unknown,
  expectedMode: Exclude<SettlementMode, "disabled">
): PaymentBaseOutcome {
  if (!isRecord(value)) {
    throw unknownResult("The payment base returned an invalid result.");
  }
  const status = stringField(value, "status");
  const operationId = stringField(value, "operationId");
  const settlementMode = stringField(value, "settlementMode");
  if (
    !operationId ||
    operationId.length > 256 ||
    containsControlCharacter(operationId) ||
    settlementMode !== expectedMode ||
    ![
      "confirmed",
      "submitted",
      "unknown",
      "failed",
      "approval_required"
    ].includes(status ?? "")
  ) {
    throw unknownResult("The payment base returned an invalid result.");
  }
  if (status === "confirmed") {
    const receiptId = stringField(value, "receiptId");
    const transactionHash = stringField(value, "transactionHash");
    const explorerUrl = stringField(value, "explorerUrl");
    const confirmedAt = stringField(value, "confirmedAt");
    if (
      !receiptId ||
      transactionHash === undefined ||
      explorerUrl === undefined ||
      !confirmedAt
    ) {
      throw unknownResult("The payment base confirmation was incomplete.");
    }
    return {
      status,
      operationId,
      settlementMode: expectedMode,
      receiptId,
      transactionHash,
      explorerUrl,
      confirmedAt
    };
  }
  const normalizedError = normalizeOutcomeError(status!);
  return {
    status: status as "submitted" | "unknown" | "failed" | "approval_required",
    operationId,
    settlementMode: expectedMode,
    ...(normalizedError ?? {})
  };
}

function normalizeOutcomeError(
  status: string
): { errorCode: string; errorMessage: string } | undefined {
  if (status === "approval_required") {
    return {
      errorCode: "PAYMENT_APPROVAL_REQUIRED",
      errorMessage: "The payment base requires approval."
    };
  }
  if (status === "unknown") {
    return {
      errorCode: "PAYMENT_OPERATION_UNKNOWN",
      errorMessage: "The payment result is unknown."
    };
  }
  if (status === "failed") {
    return {
      errorCode: "PAYMENT_FAILED",
      errorMessage: "The payment operation failed."
    };
  }
  return undefined;
}

function normalizedHttpError(body: unknown): PaymentBaseClientError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const code = error ? stringField(error, "code") : undefined;
  if (code === "PAYMENT_APPROVAL_REQUIRED") {
    return new PaymentBaseClientError(
      code,
      "The payment base requires approval."
    );
  }
  if (code === "PAYMENT_AMOUNT_UNSUPPORTED") {
    return new PaymentBaseClientError(
      code,
      "The payment amount or asset is unsupported."
    );
  }
  return unknownResult(
    "The payment base rejected the request without a recognized terminal result."
  );
}

function unavailable(message: string): PaymentBaseClientError {
  return new PaymentBaseClientError("PAYMENT_BASE_UNAVAILABLE", message);
}

function unknownResult(message: string): PaymentBaseClientError {
  return new PaymentBaseClientError("PAYMENT_OPERATION_UNKNOWN", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
