import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  ApiErrorBody,
  BotStatus,
  LivenessResponse
} from "@poolmate/shared";
import type { PoolMateConfig } from "../config.js";
import type { PoolMateDatabase } from "../infrastructure/db/database.js";
import { SystemStatusService } from "../application/systemStatusService.js";
import type { OrderService } from "../application/orderService.js";
import type { PaymentOrchestrationService } from "../application/paymentOrchestrationService.js";
import { DomainError } from "../domain/domainError.js";
import type { ConfirmationIdentityVerifier } from "./telegramWebAppIdentityVerifier.js";

export interface CreateServerOptions {
  config: PoolMateConfig;
  database: PoolMateDatabase;
  getBotStatus: () => BotStatus;
  orderService?: OrderService;
  paymentOrchestrationService?: PaymentOrchestrationService;
  identityVerifier?: ConfirmationIdentityVerifier;
  logger?: boolean;
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function extractAdminCredential(
  authorization: string | undefined,
  apiKey: string | string[] | undefined
): string | undefined {
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return Array.isArray(apiKey) ? apiKey[0] : apiKey;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const idSchema = z.string().trim().min(1).max(160);
const createGroupSchema = z
  .object({ telegramChatId: idSchema.max(64), title: idSchema.max(120) })
  .strict();
const createOrderSchema = z
  .object({
    groupId: idSchema.max(64),
    ownerUserId: idSchema.max(64),
    title: idSchema.max(120),
    targetUnits: z.number().int().positive().safe(),
    sourceIdempotencyKey: idSchema.optional()
  })
  .strict();
const claimSchema = z
  .object({
    userId: idSchema.max(64),
    displayName: idSchema.max(80),
    units: z.number().int().positive().safe()
  })
  .strict();
const updateClaimSchema = z
  .object({ units: z.number().int().positive().safe() })
  .strict();
const checkoutSchema = z.object({ merchantId: idSchema.max(64) }).strict();
const emptyBodySchema = z.object({}).strict();

function requireConfirmationToken(request: FastifyRequest): string {
  const token = firstHeader(
    request.headers["x-poolmate-confirmation-token"]
  )?.trim();
  if (!token || token.length > 256) {
    throw new DomainError(
      "CONFIRMATION_TOKEN_REQUIRED",
      "A confirmation token is required.",
      401
    );
  }
  return token;
}

async function requireConfirmationIdentity(
  request: FastifyRequest,
  verifier: ConfirmationIdentityVerifier | undefined
): Promise<string> {
  const authorization = request.headers.authorization?.trim() ?? "";
  const initData = /^tma\s+/i.test(authorization)
    ? authorization.replace(/^tma\s+/i, "").trim()
    : "";
  if (!initData || !verifier) {
    throw new DomainError(
      "CONFIRMATION_IDENTITY_REQUIRED",
      "Fresh Telegram WebApp identity proof is required.",
      401
    );
  }
  return (await verifier.verify(initData)).telegramUserId;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "INVALID_REQUEST",
      "The request body does not match the API contract.",
      400
    );
  }
  return parsed.data;
}

function disableSensitiveCaching(reply: FastifyReply): void {
  reply.header("Cache-Control", "private, no-store");
  reply.header("Pragma", "no-cache");
}

export async function createServer(
  options: CreateServerOptions
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: "info",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.x-poolmate-admin-key",
                "req.headers['x-poolmate-confirmation-token']",
                "body.token",
                "body.apiKey",
                "*.privateKey"
              ],
              censor: "[REDACTED]"
            }
          },
    bodyLimit: 256 * 1024,
    requestIdHeader: "x-request-id"
  });
  const statusService = new SystemStatusService(options);

  async function requireAdmin(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const configuredKey = options.config.admin.apiKey;
    if (!configuredKey) {
      const body: ApiErrorBody = {
        error: {
          code: "NOT_READY",
          message: "Admin access is not configured.",
          requestId: request.id
        }
      };
      await reply.status(503).send(body);
      return;
    }
    const provided = extractAdminCredential(
      request.headers.authorization,
      request.headers["x-poolmate-admin-key"]
    );
    if (!provided) {
      const body: ApiErrorBody = {
        error: {
          code: "UNAUTHORIZED",
          message: "Admin credentials are required.",
          requestId: request.id
        }
      };
      await reply.status(401).send(body);
      return;
    }
    if (!constantTimeEquals(provided, configuredKey)) {
      const body: ApiErrorBody = {
        error: {
          code: "FORBIDDEN",
          message: "Admin credentials are invalid.",
          requestId: request.id
        }
      };
      await reply.status(403).send(body);
    }
  }

  app.get("/health", async () => statusService.health());
  app.get(
    "/health/live",
    async (): Promise<LivenessResponse> => ({
      service: "poolmate-api",
      status: "ok",
      checkedAt: new Date().toISOString()
    })
  );
  app.get("/health/ready", async (_request, reply) => {
    const health = statusService.health();
    return reply.status(health.status === "ok" ? 200 : 503).send(health);
  });
  app.get("/api/public/config-status", async () =>
    statusService.configStatus()
  );
  app.get("/api/config-status", { preHandler: requireAdmin }, async () =>
    statusService.configStatus()
  );

  if (options.orderService) {
    const orderService = options.orderService;
    app.get(
      "/api/orders",
      { preHandler: requireAdmin },
      async (_request, reply) => {
        disableSensitiveCaching(reply);
        return orderService.listOrders();
      }
    );
    app.get<{ Params: { orderId: string } }>(
      "/api/orders/:orderId",
      { preHandler: requireAdmin },
      async (request, reply) => {
        disableSensitiveCaching(reply);
        return orderService.getOrder(request.params.orderId);
      }
    );
    app.get("/api/public/confirmation", async (request, reply) => {
      disableSensitiveCaching(reply);
      reply.header("Vary", "X-PoolMate-Confirmation-Token");
      return orderService.getConfirmation(requireConfirmationToken(request));
    });
    app.post("/api/public/confirmation/confirm", async (request, reply) => {
      disableSensitiveCaching(reply);
      parseInput(emptyBodySchema, request.body ?? {});
      const actorUserId = await requireConfirmationIdentity(
        request,
        options.identityVerifier
      );
      return orderService.confirm(
        requireConfirmationToken(request),
        actorUserId
      );
    });
    app.post("/api/public/confirmation/decline", async (request, reply) => {
      disableSensitiveCaching(reply);
      parseInput(emptyBodySchema, request.body ?? {});
      const actorUserId = await requireConfirmationIdentity(
        request,
        options.identityVerifier
      );
      return orderService.decline(
        requireConfirmationToken(request),
        actorUserId
      );
    });

    app.post(
      "/api/groups",
      { preHandler: requireAdmin },
      async (request, reply) =>
        reply
          .status(201)
          .send(
            orderService.createGroup(
              parseInput(createGroupSchema, request.body)
            )
          )
    );
    app.post(
      "/api/orders",
      { preHandler: requireAdmin },
      async (request, reply) =>
        reply
          .status(201)
          .send(
            orderService.createOrder(
              parseInput(createOrderSchema, request.body)
            )
          )
    );
    app.post<{ Params: { orderId: string } }>(
      "/api/orders/:orderId/publish",
      { preHandler: requireAdmin },
      async (request) => orderService.publishOrder(request.params.orderId)
    );
    app.post<{ Params: { orderId: string } }>(
      "/api/orders/:orderId/claims",
      { preHandler: requireAdmin },
      async (request) =>
        orderService.claimOrder(request.params.orderId, {
          ...parseInput(claimSchema, request.body),
          sourceIdempotencyKey: firstHeader(request.headers["idempotency-key"])
        })
    );
    app.patch<{ Params: { orderId: string; userId: string } }>(
      "/api/orders/:orderId/claims/:userId",
      { preHandler: requireAdmin },
      async (request) =>
        orderService.updateClaim(
          request.params.orderId,
          request.params.userId,
          {
            ...parseInput(updateClaimSchema, request.body),
            sourceIdempotencyKey: firstHeader(
              request.headers["idempotency-key"]
            )
          }
        )
    );
    app.delete<{ Params: { orderId: string; userId: string } }>(
      "/api/orders/:orderId/claims/:userId",
      { preHandler: requireAdmin },
      async (request) =>
        orderService.leaveOrder(
          request.params.orderId,
          request.params.userId,
          firstHeader(request.headers["idempotency-key"])
        )
    );
    app.post<{ Params: { orderId: string } }>(
      "/api/orders/:orderId/checkout",
      { preHandler: requireAdmin },
      async (request) =>
        orderService.finalizeCheckout(
          request.params.orderId,
          parseInput(checkoutSchema, request.body),
          firstHeader(request.headers["idempotency-key"])
        )
    );
    if (options.paymentOrchestrationService) {
      app.post<{ Params: { orderId: string } }>(
        "/api/orders/:orderId/payment/submit",
        { preHandler: requireAdmin },
        async (request, reply) => {
          disableSensitiveCaching(reply);
          parseInput(emptyBodySchema, request.body ?? {});
          return options.paymentOrchestrationService!.submit(
            request.params.orderId
          );
        }
      );
      app.post<{ Params: { orderId: string } }>(
        "/api/orders/:orderId/payment/recover",
        { preHandler: requireAdmin },
        async (request, reply) => {
          disableSensitiveCaching(reply);
          parseInput(emptyBodySchema, request.body ?? {});
          return options.paymentOrchestrationService!.recover(
            request.params.orderId
          );
        }
      );
    }
  }

  app.setNotFoundHandler(async (request, reply) => {
    const body: ApiErrorBody = {
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "The requested route does not exist.",
        requestId: request.id
      }
    };
    return reply.status(404).send(body);
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof DomainError) {
      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id
        }
      };
      return reply.status(error.statusCode).send(body);
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 400
    ) {
      const body: ApiErrorBody = {
        error: {
          code: "INVALID_REQUEST",
          message: "The request could not be parsed.",
          requestId: request.id
        }
      };
      return reply.status(400).send(body);
    }
    request.log.error({ error }, "request failed");
    const body: ApiErrorBody = {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: request.id
      }
    };
    return reply.status(500).send(body);
  });

  return app;
}
