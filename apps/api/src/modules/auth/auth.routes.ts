import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler, HttpError, success } from "../../lib/http.js";
import {
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  type AuthService,
} from "./auth.service.js";

const refreshCookie = "approveflow_refresh";
const credentialsSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(8).max(256),
  })
  .strict();

interface AuthRouterOptions {
  readonly service: AuthService;
  readonly production: boolean;
  readonly refreshTokenTtlDays: number;
}

function cookieOptions(production: boolean, maxAge?: number) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "strict" as const,
    path: "/api/v1/auth",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  router.post(
    "/login",
    limiter,
    asyncHandler(async (request, response) => {
      const parsed = credentialsSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
          fields: z.flattenError(parsed.error).fieldErrors,
        });
      }
      try {
        const tokens = await options.service.login(
          parsed.data.email,
          parsed.data.password,
        );
        response.cookie(
          refreshCookie,
          tokens.refreshToken,
          cookieOptions(
            options.production,
            options.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
          ),
        );
        response.json(success(request, { accessToken: tokens.accessToken }));
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          throw new HttpError(
            401,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
          );
        }
        throw error;
      }
    }),
  );

  router.post(
    "/refresh",
    limiter,
    asyncHandler(async (request, response) => {
      const token = request.cookies[refreshCookie] as unknown;
      if (typeof token !== "string") {
        throw new HttpError(
          401,
          "INVALID_REFRESH_TOKEN",
          "Authentication required",
        );
      }
      try {
        const tokens = await options.service.refresh(token);
        response.cookie(
          refreshCookie,
          tokens.refreshToken,
          cookieOptions(
            options.production,
            options.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
          ),
        );
        response.json(success(request, { accessToken: tokens.accessToken }));
      } catch (error) {
        if (error instanceof InvalidRefreshTokenError) {
          response.clearCookie(
            refreshCookie,
            cookieOptions(options.production),
          );
          throw new HttpError(
            401,
            "INVALID_REFRESH_TOKEN",
            "Authentication required",
          );
        }
        throw error;
      }
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (request, response) => {
      const token = request.cookies[refreshCookie] as unknown;
      if (typeof token === "string") await options.service.logout(token);
      response.clearCookie(refreshCookie, cookieOptions(options.production));
      response.status(204).send();
    }),
  );
  return router;
}
