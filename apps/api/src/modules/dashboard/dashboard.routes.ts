import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, success } from "../../lib/http.js";
import { authenticate, resolveTenant } from "../tenant/tenant.middleware.js";
import type {
  AccessTokenVerifier,
  TenantRepository,
} from "../tenant/tenant.types.js";
import { dashboardQuerySchema } from "./dashboard.schemas.js";
import { DashboardService, type DashboardScope } from "./dashboard.service.js";

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
function scope(request: Request): DashboardScope {
  const permissions = context(request).permissions;
  if (permissions.has("request.read_all")) return "ALL";
  if (permissions.has("request.read_department")) return "DEPARTMENT";
  if (permissions.has("request.read_own")) return "OWN";
  if (permissions.has("approval.read_assigned")) return "ASSIGNED";
  throw new HttpError(403, "PERMISSION_DENIED", "Permission denied");
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
      issues: z.flattenError(result.error),
    });
  return result.data;
}
export function createDashboardRouter(
  service: DashboardService,
  verifier: AccessTokenVerifier,
  tenants: TenantRepository,
) {
  const router = Router();
  router.use(
    "/organizations/:organizationId/document-types/:documentTypeId/dashboard",
    authenticate(verifier),
    resolveTenant(tenants),
  );
  router.get(
    "/organizations/:organizationId/document-types/:documentTypeId/dashboard",
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      response.json(
        success(
          request,
          await service.list(
            tenant.organizationId,
            parse(id, request.params.documentTypeId),
            tenant.membershipId,
            scope(request),
            parse(dashboardQuerySchema, request.query),
          ),
        ),
      );
    }),
  );
  router.get(
    "/organizations/:organizationId/document-types/:documentTypeId/dashboard/export",
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      if (!tenant.permissions.has("request.export"))
        throw new HttpError(403, "PERMISSION_DENIED", "Permission denied");
      const csv = await service.export(
        tenant.organizationId,
        parse(id, request.params.documentTypeId),
        tenant.membershipId,
        scope(request),
        parse(dashboardQuerySchema, request.query),
      );
      response
        .type("text/csv")
        .setHeader(
          "content-disposition",
          "attachment; filename=approveflow-export.csv",
        )
        .send(csv);
    }),
  );
  return router;
}
