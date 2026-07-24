import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type {
  ApiErrorBody,
  BotStatus,
  LivenessResponse
} from "@poolmate/shared";
import type { PoolMateConfig } from "../config.js";
import type { PoolMateDatabase } from "../infrastructure/db/database.js";
import { SystemStatusService } from "../application/systemStatusService.js";

export interface CreateServerOptions {
  config: PoolMateConfig;
  database: PoolMateDatabase;
  getBotStatus: () => BotStatus;
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
  app.get("/api/config-status", async (request, reply) => {
    const configuredKey = options.config.admin.apiKey;
    if (!configuredKey) {
      const body: ApiErrorBody = {
        error: {
          code: "NOT_READY",
          message: "Admin access is not configured.",
          requestId: request.id
        }
      };
      return reply.status(503).send(body);
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
      return reply.status(401).send(body);
    }
    if (!constantTimeEquals(provided, configuredKey)) {
      const body: ApiErrorBody = {
        error: {
          code: "FORBIDDEN",
          message: "Admin credentials are invalid.",
          requestId: request.id
        }
      };
      return reply.status(403).send(body);
    }
    return statusService.configStatus();
  });

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
