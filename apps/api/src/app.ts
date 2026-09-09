import { randomUUID } from "node:crypto";
import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import type { ApiError, ApiSuccess } from "@approveflow/contracts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

function correlationId(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "unknown";
}

export function createApp(webOrigin: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      genReqId(request, response) {
        const supplied = request.headers["x-correlation-id"];
        const correlationId =
          typeof supplied === "string" ? supplied : randomUUID();
        response.setHeader("x-correlation-id", correlationId);
        return correlationId;
      },
    }),
  );

  const health: RequestHandler = (request, response) => {
    const body: ApiSuccess<{ status: "ok" }> = {
      data: { status: "ok" },
      meta: { correlationId: correlationId(request.id) },
    };
    response.json(body);
  };
  app.get("/health", health);
  app.get("/api/v1/health", health);

  app.use((request, response) => {
    const body: ApiError = {
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
        correlationId: correlationId(request.id),
      },
    };
    response.status(404).json(body);
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    request.log.error({ err: error }, "Unhandled request error");
    const body: ApiError = {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        correlationId: correlationId(request.id),
      },
    };
    response.status(500).json(body);
  };
  app.use(errorHandler);
  return app;
}
