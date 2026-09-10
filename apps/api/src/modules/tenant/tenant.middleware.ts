import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../../lib/http.js";
import type { AccessTokenVerifier, TenantRepository } from "./tenant.types.js";

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  return token.length > 0 ? token : null;
}

export function authenticate(verifier: AccessTokenVerifier): RequestHandler {
  return (request, _response, next) => {
    const token = bearerToken(request.header("authorization"));
    if (!token) {
      next(
        new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication required",
        ),
      );
      return;
    }
    void verifier
      .verify(token)
      .then((userId) => {
        if (!userId) {
          next(
            new HttpError(
              401,
              "AUTHENTICATION_REQUIRED",
              "Authentication required",
            ),
          );
          return;
        }
        request.authenticatedUserId = userId;
        next();
      })
      .catch(next);
  };
}

export function resolveTenant(repository: TenantRepository): RequestHandler {
  return (request, _response, next) => {
    const userId = request.authenticatedUserId;
    const organizationId = request.header("x-organization-id");
    if (!userId) {
      next(
        new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication required",
        ),
      );
      return;
    }
    if (!organizationId || !z.uuid().safeParse(organizationId).success) {
      next(
        new HttpError(
          400,
          "ORGANIZATION_REQUIRED",
          "Active organization required",
        ),
      );
      return;
    }
    void repository
      .resolveActiveContext(userId, organizationId)
      .then((context) => {
        if (!context) {
          next(
            new HttpError(
              403,
              "ORGANIZATION_ACCESS_DENIED",
              "Organization access denied",
            ),
          );
          return;
        }
        request.tenantContext = context;
        next();
      })
      .catch(next);
  };
}

export function requirePermission(permission: string): RequestHandler {
  return (request, _response, next) => {
    if (!request.tenantContext?.permissions.has(permission)) {
      next(new HttpError(403, "PERMISSION_DENIED", "Permission denied"));
      return;
    }
    next();
  };
}
