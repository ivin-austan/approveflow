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
import { DeliveryOperationsService } from "./delivery.service.js";

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

export function createDeliveryRouter(
  service: DeliveryOperationsService,
  verifier: AccessTokenVerifier,
  tenants: TenantRepository,
) {
  const router = Router();
  router.post(
    "/organizations/:organizationId/deliveries/:deliveryId/reopen",
    authenticate(verifier),
    resolveTenant(tenants),
    requirePermission("approved_pdf.retry"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const parsed = id.safeParse(request.params.deliveryId);
      if (!parsed.success)
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid delivery ID");
      try {
        await service.reopen(
          tenant.organizationId,
          parsed.data,
          tenant.membershipId,
        );
      } catch {
        throw new HttpError(
          409,
          "DELIVERY_NOT_REOPENABLE",
          "Delivery cannot be reopened",
        );
      }
      response.status(202).json(success(request, { deliveryId: parsed.data }));
    }),
  );
  return router;
}
