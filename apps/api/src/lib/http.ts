import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ApiError, ApiSuccess } from "@approveflow/contracts";

export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}

export function correlationId(request: Request): string {
  return typeof request.id === "string" || typeof request.id === "number"
    ? String(request.id)
    : "unknown";
}

export function success<T>(request: Request, data: T): ApiSuccess<T> {
  return { data, meta: { correlationId: correlationId(request) } };
}

export function errorBody(request: Request, error: HttpError): ApiError {
  return {
    error: {
      code: error.code,
      message: error.message,
      correlationId: correlationId(request),
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

export function asyncHandler(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}
