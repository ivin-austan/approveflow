import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, success } from "../../lib/http.js";
import { authenticate, resolveTenant } from "../tenant/tenant.middleware.js";
import type {
  AccessTokenVerifier,
  TenantRepository,
} from "../tenant/tenant.types.js";
import { AuditService, TimelineNotFoundError } from "./audit.service.js";

const id = z.uuid();
export function createAuditRouter(
  service: AuditService,
  verifier: AccessTokenVerifier,
  tenants: TenantRepository,
) {
  const router = Router();
  router.get(
    "/organizations/:organizationId/requests/:requestId/timeline",
    authenticate(verifier),
    resolveTenant(tenants),
    asyncHandler(async (request: Request, response) => {
      const tenant = request.tenantContext;
      if (!tenant || request.params.organizationId !== tenant.organizationId)
        throw new HttpError(
          403,
          "ORGANIZATION_ACCESS_DENIED",
          "Organization access denied",
        );
      const requestId = id.safeParse(request.params.requestId);
      if (!requestId.success)
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid request ID");
      try {
        response.json(
          success(
            request,
            await service.timeline(
              tenant.organizationId,
              requestId.data,
              tenant.membershipId,
              tenant.permissions.has("audit.read") ||
                tenant.permissions.has("request.read_all"),
              tenant.permissions.has("approval.read_assigned"),
            ),
          ),
        );
      } catch (error) {
        if (error instanceof TimelineNotFoundError)
          throw new HttpError(404, "REQUEST_NOT_FOUND", "Request not found");
        throw error;
      }
    }),
  );
  return router;
}
