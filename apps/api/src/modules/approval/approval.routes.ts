import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, success } from "../../lib/http.js";
import {
  authenticate,
  requirePermission,
  resolveTenant,
} from "../tenant/tenant.middleware.js";
import type {
  AccessTokenVerifier,
  TenantRepository,
} from "../tenant/tenant.types.js";
import { decisionSchema, reassignSchema } from "./approval.schemas.js";
import { ApprovalCommandError, ApprovalService } from "./approval.service.js";

const id = z.uuid();
function context(request: Request) {
  if (
    !request.tenantContext ||
    request.params.organizationId !== request.tenantContext.organizationId
  )
    throw new HttpError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Organization access denied",
    );
  return request.tenantContext;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
      issues: z.flattenError(result.error),
    });
  return result.data;
}
function key(request: Request) {
  const value = request.header("idempotency-key");
  if (!value || value.length > 200)
    throw new HttpError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required",
    );
  return value;
}
function map(error: unknown): never {
  if (error instanceof ApprovalCommandError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "SELF_APPROVAL_DENIED"
          ? 403
          : 409;
    throw new HttpError(
      status,
      error.code,
      error.code === "SELF_APPROVAL_DENIED"
        ? "You cannot approve your own request"
        : "The approval action could not be completed",
    );
  }
  throw error;
}
export function createApprovalRouter(
  service: ApprovalService,
  verifier: AccessTokenVerifier,
  tenants: TenantRepository,
) {
  const router = Router();
  router.use(
    "/organizations/:organizationId/approvals",
    authenticate(verifier),
    resolveTenant(tenants),
  );
  router.get(
    "/organizations/:organizationId/approvals/inbox",
    requirePermission("approval.read_assigned"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      response.json(
        success(
          request,
          await service.inbox(tenant.organizationId, tenant.membershipId),
        ),
      );
    }),
  );
  router.post(
    "/organizations/:organizationId/approvals/:taskId/decisions",
    requirePermission("approval.decide"),
    asyncHandler(async (request, response) => {
      try {
        const tenant = context(request);
        await service.decide(
          tenant.organizationId,
          tenant.membershipId,
          parse(id, request.params.taskId),
          key(request),
          parse(decisionSchema, request.body),
        );
        response.status(204).send();
      } catch (error) {
        map(error);
      }
    }),
  );
  router.post(
    "/organizations/:organizationId/approvals/:taskId/reassign",
    requirePermission("approval.reassign"),
    asyncHandler(async (request, response) => {
      try {
        const tenant = context(request);
        await service.reassign(
          tenant.organizationId,
          tenant.membershipId,
          parse(id, request.params.taskId),
          key(request),
          parse(reassignSchema, request.body),
        );
        response.status(204).send();
      } catch (error) {
        map(error);
      }
    }),
  );
  return router;
}
