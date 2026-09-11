import { randomUUID } from "node:crypto";
import cors from "cors";
import cookieParser from "cookie-parser";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import type { ApiError, ApiSuccess } from "@approveflow/contracts";
import { errorBody, HttpError, correlationId } from "./lib/http.js";
import type { Router } from "express";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

interface AppOptions {
  readonly webOrigin: string;
  readonly authRouter?: Router;
  readonly tenantRouter?: Router;
  readonly onboardingRouter?: Router;
  readonly administrationRouter?: Router;
  readonly workflowRouter?: Router;
  readonly workflowConfigurationRouter?: Router;
  readonly approverOptionRouter?: Router;
}

export function createApp(options: string | AppOptions) {
  const settings =
    typeof options === "string" ? { webOrigin: options } : options;
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: settings.webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
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
      meta: { correlationId: correlationId(request) },
    };
    response.json(body);
  };
  app.get("/health", health);
  app.get("/api/v1/health", health);
  if (settings.authRouter) app.use("/api/v1/auth", settings.authRouter);
  if (settings.tenantRouter) app.use("/api/v1", settings.tenantRouter);
  if (settings.onboardingRouter)
    app.use("/api/v1/onboarding", settings.onboardingRouter);
  if (settings.administrationRouter)
    app.use("/api/v1/admin", settings.administrationRouter);
  if (settings.workflowRouter) app.use("/api/v1", settings.workflowRouter);
  if (settings.workflowConfigurationRouter)
    app.use("/api/v1", settings.workflowConfigurationRouter);
  if (settings.approverOptionRouter)
    app.use("/api/v1", settings.approverOptionRouter);

  app.use((request, response) => {
    const body: ApiError = {
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
        correlationId: correlationId(request),
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
    if (error instanceof HttpError) {
      response.status(error.status).json(errorBody(request, error));
      return;
    }
    request.log.error({ err: error }, "Unhandled request error");
    const body: ApiError = {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        correlationId: correlationId(request),
      },
    };
    response.status(500).json(body);
  };
  app.use(errorHandler);
  return app;
}
