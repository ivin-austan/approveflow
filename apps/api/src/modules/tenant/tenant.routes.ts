import { Router } from "express";
import { asyncHandler, HttpError, success } from "../../lib/http.js";
import { authenticate, resolveTenant } from "./tenant.middleware.js";
import type { AccessTokenVerifier, TenantRepository } from "./tenant.types.js";

export function createTenantRouter(
  verifier: AccessTokenVerifier,
  repository: TenantRepository,
): Router {
  const router = Router();
  router.use(authenticate(verifier));
  router.get(
    "/organizations",
    asyncHandler(async (request, response) => {
      if (!request.authenticatedUserId) {
        throw new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication required",
        );
      }
      const organizations = await repository.listActiveOrganizations(
        request.authenticatedUserId,
      );
      response.json(success(request, { organizations }));
    }),
  );
  router.get("/context", resolveTenant(repository), (request, response) => {
    const context = request.tenantContext;
    if (!context)
      throw new HttpError(
        403,
        "ORGANIZATION_ACCESS_DENIED",
        "Organization access denied",
      );
    response.json(
      success(request, {
        organizationId: context.organizationId,
        membershipId: context.membershipId,
        permissions: [...context.permissions].sort(),
      }),
    );
  });
  return router;
}
