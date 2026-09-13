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
  createDraftSchema,
  resubmitRequestSchema,
  submitRequestSchema,
  updateDraftSchema,
} from "./request.schemas.js";
import {
  RequestConflictError,
  RequestImmutableError,
  RequestInputError,
  RequestNotFoundError,
  RequestService,
  SubmissionError,
} from "./request.service.js";

const idSchema = z.uuid();
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
function mapError(error: unknown): never {
  if (error instanceof RequestNotFoundError)
    throw new HttpError(404, "REQUEST_NOT_FOUND", error.message);
  if (error instanceof RequestConflictError)
    throw new HttpError(409, "REQUEST_CONFLICT", error.message);
  if (error instanceof RequestImmutableError)
    throw new HttpError(409, "REQUEST_IMMUTABLE", error.message);
  if (error instanceof RequestInputError)
    throw new HttpError(422, "INVALID_ANSWERS", error.message, {
      issues: error.issues,
    });
  if (error instanceof SubmissionError)
    throw new HttpError(409, error.code, "Request could not be submitted");
  throw error;
}

export function createRequestRouter(
  service: RequestService,
  verifier: AccessTokenVerifier,
  tenants: TenantRepository,
) {
  const router = Router();
  router.use(
    "/organizations/:organizationId",
    authenticate(verifier),
    resolveTenant(tenants),
  );
  router.get(
    "/organizations/:organizationId/requests",
    requirePermission("request.read_own"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      response.json(
        success(
          request,
          await service.list(tenant.organizationId, tenant.membershipId),
        ),
      );
    }),
  );
  router.get(
    "/organizations/:organizationId/request-forms/:workflowId",
    requirePermission("request.create"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const form = await service.getForm(
        tenant.organizationId,
        parse(idSchema, request.params.workflowId),
      );
      if (!form)
        throw new HttpError(
          404,
          "WORKFLOW_NOT_FOUND",
          "Published workflow not found",
        );
      response.json(success(request, form));
    }),
  );
  router.post(
    "/organizations/:organizationId/requests",
    requirePermission("request.create"),
    asyncHandler(async (request, response) => {
      try {
        const tenant = context(request);
        response
          .status(201)
          .json(
            success(
              request,
              await service.createDraft(
                tenant.organizationId,
                tenant.membershipId,
                parse(createDraftSchema, request.body),
              ),
            ),
          );
      } catch (error) {
        mapError(error);
      }
    }),
  );
  router.post(
    "/organizations/:organizationId/requests/:requestId/resubmit",
    requirePermission("request.create"),
    asyncHandler(async (request, response) => {
      const idempotencyKey = request.header("idempotency-key");
      if (!idempotencyKey || idempotencyKey.length > 200)
        throw new HttpError(
          400,
          "IDEMPOTENCY_KEY_REQUIRED",
          "A valid Idempotency-Key header is required",
        );
      try {
        const tenant = context(request);
        response.json(
          success(
            request,
            await service.resubmit(
              tenant.organizationId,
              tenant.membershipId,
              parse(idSchema, request.params.requestId),
              idempotencyKey,
              parse(resubmitRequestSchema, request.body),
            ),
          ),
        );
      } catch (error) {
        mapError(error);
      }
    }),
  );
  router.put(
    "/organizations/:organizationId/requests/:requestId",
    requirePermission("request.create"),
    asyncHandler(async (request, response) => {
      try {
        const tenant = context(request);
        response.json(
          success(
            request,
            await service.updateDraft(
              tenant.organizationId,
              tenant.membershipId,
              parse(idSchema, request.params.requestId),
              parse(updateDraftSchema, request.body),
            ),
          ),
        );
      } catch (error) {
        mapError(error);
      }
    }),
  );
  router.post(
    "/organizations/:organizationId/requests/:requestId/submit",
    requirePermission("request.create"),
    asyncHandler(async (request, response) => {
      const key = request.header("idempotency-key");
      if (!key || key.length > 200)
        throw new HttpError(
          400,
          "IDEMPOTENCY_KEY_REQUIRED",
          "A valid Idempotency-Key header is required",
        );
      try {
        const tenant = context(request);
        response.json(
          success(
            request,
            await service.submit(
              tenant.organizationId,
              tenant.membershipId,
              parse(idSchema, request.params.requestId),
              key,
              parse(submitRequestSchema, request.body),
            ),
          ),
        );
      } catch (error) {
        mapError(error);
      }
    }),
  );
  router.get(
    "/organizations/:organizationId/requests/:requestId",
    requirePermission("request.read_own"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const item = await service.get(
        tenant.organizationId,
        tenant.membershipId,
        parse(idSchema, request.params.requestId),
      );
      if (!item)
        throw new HttpError(404, "REQUEST_NOT_FOUND", "Request not found");
      response.json(success(request, item));
    }),
  );
  return router;
}
