import { Router, type Request } from "express";
import { HttpError, asyncHandler, success } from "../../lib/http.js";
import {
  authenticate,
  requirePermission,
  resolveTenant,
} from "../tenant/tenant.middleware.js";
import type {
  AccessTokenVerifier,
  TenantRepository,
} from "../tenant/tenant.types.js";
import type { ApproverOptionService } from "./approver-options.service.js";

function organization(request: Request): string {
  const tenant = request.tenantContext;
  if (!tenant || request.params.organizationId !== tenant.organizationId)
    throw new HttpError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Organization access denied",
    );
  return tenant.organizationId;
}

export function createApproverOptionRouter(
  service: ApproverOptionService,
  verifier: AccessTokenVerifier,
  tenants: TenantRepository,
): Router {
  const router = Router();
  router.use(authenticate(verifier));
  router.use(resolveTenant(tenants));
  const base = "/organizations/:organizationId/approver-options";
  router.get(
    `${base}/memberships`,
    requirePermission("workflow.edit"),
    asyncHandler(async (request, response) => {
      response.json(
        success(request, await service.listMemberships(organization(request))),
      );
    }),
  );
  router.get(
    `${base}/roles`,
    requirePermission("workflow.edit"),
    asyncHandler(async (request, response) => {
      response.json(
        success(request, await service.listRoles(organization(request))),
      );
    }),
  );
  router.get(
    `${base}/departments`,
    requirePermission("workflow.edit"),
    asyncHandler(async (request, response) => {
      response.json(
        success(request, await service.listDepartments(organization(request))),
      );
    }),
  );
  return router;
}
