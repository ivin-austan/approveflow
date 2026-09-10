import { Router } from "express";
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
import {
  AdministrationReferenceError,
  type AdministrationService,
  AdministrationValidationError,
} from "./administration.service.js";

const id = z.uuid();
const departmentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
const roleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    permissionKeys: z.array(z.string().min(1).max(100)).max(100),
  })
  .strict();
const assignmentsSchema = z
  .object({
    reportingManagerMembershipId: id.nullable(),
    departmentIds: z.array(id).min(1).max(50),
    defaultDepartmentId: id,
    roleIds: z.array(id).max(50),
  })
  .strict();
const invitationSchema = assignmentsSchema
  .omit({ reportingManagerMembershipId: true })
  .extend({
    email: z.email().max(320),
    fullName: z.string().trim().min(1).max(120),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
      fields: z.flattenError(result.error).fieldErrors,
    });
  }
  return result.data;
}

function tenant(request: Express.Request) {
  if (!request.tenantContext) {
    throw new HttpError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Organization access denied",
    );
  }
  return request.tenantContext;
}

function translateAdministrationError(error: unknown): never {
  if (error instanceof AdministrationValidationError) {
    throw new HttpError(400, "VALIDATION_ERROR", error.message);
  }
  if (error instanceof AdministrationReferenceError) {
    throw new HttpError(404, "RESOURCE_NOT_FOUND", "Resource not found");
  }
  throw error;
}

export function createAdministrationRouter(
  service: AdministrationService,
  verifier: AccessTokenVerifier,
  tenantRepository: TenantRepository,
): Router {
  const router = Router();
  router.use(authenticate(verifier));
  router.use(resolveTenant(tenantRepository));

  router.post(
    "/departments",
    requirePermission("department.manage"),
    asyncHandler(async (request, response) => {
      const result = await service.createDepartment(
        tenant(request).organizationId,
        parse(departmentSchema, request.body),
      );
      response.status(201).json(success(request, result));
    }),
  );
  router.post(
    "/roles",
    requirePermission("role.manage"),
    asyncHandler(async (request, response) => {
      const result = await service.createRole(
        tenant(request).organizationId,
        parse(roleSchema, request.body),
      );
      response.status(201).json(success(request, result));
    }),
  );
  router.put(
    "/memberships/:membershipId/assignments",
    requirePermission("membership.manage"),
    asyncHandler(async (request, response) => {
      const membershipId = parse(id, request.params.membershipId);
      try {
        await service.configureMembership(
          tenant(request).organizationId,
          membershipId,
          parse(assignmentsSchema, request.body),
        );
        response.status(204).send();
      } catch (error) {
        translateAdministrationError(error);
      }
    }),
  );
  router.post(
    "/invitations",
    requirePermission("membership.manage"),
    asyncHandler(async (request, response) => {
      const context = tenant(request);
      try {
        const result = await service.invite(
          context.organizationId,
          context.membershipId,
          parse(invitationSchema, request.body),
        );
        response.status(201).json(success(request, result));
      } catch (error) {
        translateAdministrationError(error);
      }
    }),
  );
  router.post(
    "/invitations/:invitationId/revoke",
    requirePermission("membership.manage"),
    asyncHandler(async (request, response) => {
      try {
        await service.revokeInvitation(
          tenant(request).organizationId,
          parse(id, request.params.invitationId),
        );
        response.status(204).send();
      } catch (error) {
        translateAdministrationError(error);
      }
    }),
  );
  return router;
}
