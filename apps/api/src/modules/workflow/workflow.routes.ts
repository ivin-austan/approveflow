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
import { replaceDraftSchema } from "./workflow.schemas.js";
import {
  InvalidWorkflowError,
  PublishedWorkflowImmutableError,
  WorkflowNotFoundError,
  WorkflowRevisionConflictError,
  type WorkflowService,
} from "./workflow.service.js";

const idSchema = z.uuid();
const previewSchema = z
  .object({ answers: z.record(z.string(), z.unknown()) })
  .strict();
const publishSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
      fields: z.flattenError(result.error).fieldErrors,
    });
  return result.data;
}

function context(request: Request) {
  const tenant = request.tenantContext;
  if (!tenant || request.params.organizationId !== tenant.organizationId)
    throw new HttpError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Organization access denied",
    );
  return tenant;
}

function translate(error: unknown): never {
  if (error instanceof WorkflowNotFoundError)
    throw new HttpError(404, "WORKFLOW_NOT_FOUND", "Workflow not found");
  if (error instanceof WorkflowRevisionConflictError)
    throw new HttpError(
      409,
      "WORKFLOW_REVISION_CONFLICT",
      "The workflow draft was changed by another editor",
    );
  if (error instanceof PublishedWorkflowImmutableError)
    throw new HttpError(
      409,
      "PUBLISHED_WORKFLOW_IMMUTABLE",
      "Published workflow versions cannot be changed",
    );
  if (error instanceof InvalidWorkflowError)
    throw new HttpError(422, "WORKFLOW_INVALID", error.message, {
      issues: error.issues,
    });
  throw error;
}

export function createWorkflowRouter(
  service: WorkflowService,
  verifier: AccessTokenVerifier,
  tenantRepository: TenantRepository,
): Router {
  const router = Router();
  router.use(authenticate(verifier));
  router.use(resolveTenant(tenantRepository));
  const path =
    "/organizations/:organizationId/workflows/:workflowId/versions/:versionId";

  router.get(
    path,
    requirePermission("workflow.read"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const workflowId = parse(idSchema, request.params.workflowId);
      const versionId = parse(idSchema, request.params.versionId);
      const draft = await service.getDraft(
        tenant.organizationId,
        workflowId,
        versionId,
      );
      if (!draft)
        throw new HttpError(404, "WORKFLOW_NOT_FOUND", "Workflow not found");
      response.json(success(request, draft));
    }),
  );

  router.put(
    path,
    requirePermission("workflow.edit"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      try {
        const result = await service.replaceDraft(
          tenant.organizationId,
          parse(idSchema, request.params.workflowId),
          parse(idSchema, request.params.versionId),
          parse(replaceDraftSchema, request.body),
        );
        response.json(success(request, result));
      } catch (error) {
        translate(error);
      }
    }),
  );

  router.post(
    `${path}/validate`,
    requirePermission("workflow.edit"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      try {
        response.json(
          success(
            request,
            await service.validate(
              tenant.organizationId,
              parse(idSchema, request.params.workflowId),
              parse(idSchema, request.params.versionId),
            ),
          ),
        );
      } catch (error) {
        translate(error);
      }
    }),
  );

  router.post(
    `${path}/preview`,
    requirePermission("workflow.read"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const body = parse(previewSchema, request.body);
      try {
        response.json(
          success(
            request,
            await service.preview(
              tenant.organizationId,
              parse(idSchema, request.params.workflowId),
              parse(idSchema, request.params.versionId),
              body.answers,
            ),
          ),
        );
      } catch (error) {
        translate(error);
      }
    }),
  );

  router.post(
    `${path}/publish`,
    requirePermission("workflow.publish"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const body = parse(publishSchema, request.body);
      try {
        await service.publish(
          tenant.organizationId,
          parse(idSchema, request.params.workflowId),
          parse(idSchema, request.params.versionId),
          tenant.membershipId,
          body.expectedRevision,
        );
        response.status(204).send();
      } catch (error) {
        translate(error);
      }
    }),
  );
  return router;
}
