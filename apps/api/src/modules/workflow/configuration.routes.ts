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
import {
  businessCalendarInputSchema,
  documentTypeInputSchema,
} from "./configuration.schemas.js";
import {
  ConfigurationReferenceError,
  ConfigurationRevisionConflictError,
  ConfigurationValidationError,
  type WorkflowConfigurationService,
} from "./configuration.service.js";

function organization(request: Request): string {
  const context = request.tenantContext;
  if (!context || request.params.organizationId !== context.organizationId)
    throw new HttpError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Organization access denied",
    );
  return context.organizationId;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
      fields: z.flattenError(result.error).fieldErrors,
    });
  return result.data;
}

function translate(error: unknown): never {
  if (error instanceof ConfigurationValidationError)
    throw new HttpError(400, "VALIDATION_ERROR", error.message);
  if (error instanceof ConfigurationRevisionConflictError)
    throw new HttpError(409, "CONFIGURATION_REVISION_CONFLICT", error.message);
  if (error instanceof ConfigurationReferenceError)
    throw new HttpError(404, "RESOURCE_NOT_FOUND", "Resource not found");
  throw error;
}

export function createWorkflowConfigurationRouter(
  service: WorkflowConfigurationService,
  verifier: AccessTokenVerifier,
  tenantRepository: TenantRepository,
): Router {
  const router = Router();
  router.use(authenticate(verifier));
  router.use(resolveTenant(tenantRepository));
  router.get(
    "/organizations/:organizationId/business-calendars",
    requirePermission("organization.read"),
    asyncHandler(async (request, response) => {
      response.json(
        success(
          request,
          await service.listBusinessCalendars(organization(request)),
        ),
      );
    }),
  );
  router.post(
    "/organizations/:organizationId/business-calendars",
    requirePermission("organization.manage"),
    asyncHandler(async (request, response) => {
      try {
        response
          .status(201)
          .json(
            success(
              request,
              await service.saveBusinessCalendar(
                organization(request),
                parse(businessCalendarInputSchema, request.body),
              ),
            ),
          );
      } catch (error) {
        translate(error);
      }
    }),
  );
  router.patch(
    "/organizations/:organizationId/business-calendars/:calendarId",
    requirePermission("organization.manage"),
    asyncHandler(async (request, response) => {
      try {
        response.json(
          success(
            request,
            await service.saveBusinessCalendar(
              organization(request),
              parse(businessCalendarInputSchema, request.body),
              parse(z.uuid(), request.params.calendarId),
            ),
          ),
        );
      } catch (error) {
        translate(error);
      }
    }),
  );
  router.post(
    "/organizations/:organizationId/document-types",
    requirePermission("organization.manage"),
    asyncHandler(async (request, response) => {
      try {
        response
          .status(201)
          .json(
            success(
              request,
              await service.createDocumentType(
                organization(request),
                parse(documentTypeInputSchema, request.body),
              ),
            ),
          );
      } catch (error) {
        translate(error);
      }
    }),
  );
  router.get(
    "/organizations/:organizationId/document-types",
    requirePermission("organization.read"),
    asyncHandler(async (request, response) => {
      response.json(
        success(
          request,
          await service.listDocumentTypes(organization(request)),
        ),
      );
    }),
  );
  return router;
}
