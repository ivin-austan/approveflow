import { createHash } from "node:crypto";
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
import type { ArtifactStorage } from "./artifact.service.js";
import {
  ArtifactGrantService,
  ArtifactOperationsService,
} from "./artifact.service.js";

const id = z.uuid();
const purposeSchema = z.enum(["VIEW", "PRINT", "DOWNLOAD"]);
const grantSchema = z.object({ purpose: purposeSchema }).strict();
const legalHoldSchema = z.object({ enabled: z.boolean() }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
      issues: z.flattenError(result.error),
    });
  return result.data;
}
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
export function createArtifactRouter(
  service: ArtifactGrantService,
  operations: ArtifactOperationsService,
  storage: ArtifactStorage,
  verifier: AccessTokenVerifier,
  tenants: TenantRepository,
) {
  const router = Router();
  router.use(
    "/organizations/:organizationId/artifacts",
    authenticate(verifier),
    resolveTenant(tenants),
    requirePermission("approved_pdf.read"),
  );
  router.post(
    "/organizations/:organizationId/artifacts/:artifactId/access-grants",
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const artifactId = parse(id, request.params.artifactId);
      const { purpose } = parse(grantSchema, request.body);
      response
        .status(201)
        .json(
          success(
            request,
            await service.issue(
              tenant.organizationId,
              artifactId,
              tenant.membershipId,
              purpose,
            ),
          ),
        );
    }),
  );
  router.put(
    "/organizations/:organizationId/artifacts/:artifactId/legal-hold",
    requirePermission("approved_pdf.retry"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const artifactId = parse(id, request.params.artifactId);
      const { enabled } = parse(legalHoldSchema, request.body);
      try {
        await operations.setLegalHold(
          tenant.organizationId,
          artifactId,
          tenant.membershipId,
          enabled,
        );
      } catch {
        throw new HttpError(
          409,
          "ARTIFACT_LEGAL_HOLD_CONFLICT",
          "Artifact legal hold cannot be changed",
        );
      }
      response.json(success(request, { artifactId, legalHold: enabled }));
    }),
  );
  router.get(
    "/organizations/:organizationId/artifacts/:artifactId/content",
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const artifactId = parse(id, request.params.artifactId);
      const purpose = parse(purposeSchema, request.query.purpose);
      const token = request.header("x-artifact-grant");
      if (!token)
        throw new HttpError(
          401,
          "ARTIFACT_GRANT_REQUIRED",
          "Artifact access grant required",
        );
      const artifact = await service.consume(
        tenant.organizationId,
        artifactId,
        tenant.membershipId,
        purpose,
        token,
      );
      if (!artifact)
        throw new HttpError(404, "ARTIFACT_NOT_FOUND", "Artifact not found");
      const bytes = await storage.get(artifact.objectKey);
      if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
        throw new HttpError(
          503,
          "ARTIFACT_INTEGRITY_ERROR",
          "Artifact is temporarily unavailable",
        );
      response.type("application/pdf");
      response.setHeader("cache-control", "private, no-store");
      response.setHeader(
        "content-disposition",
        `${purpose === "DOWNLOAD" ? "attachment" : "inline"}; filename="approved-document.pdf"`,
      );
      response.send(Buffer.from(bytes));
    }),
  );
  router.post(
    "/organizations/:organizationId/artifacts/:artifactId/retry",
    requirePermission("approved_pdf.retry"),
    asyncHandler(async (request, response) => {
      const tenant = context(request);
      const artifactId = parse(id, request.params.artifactId);
      try {
        await operations.retryGeneration(
          tenant.organizationId,
          artifactId,
          tenant.membershipId,
        );
      } catch {
        throw new HttpError(
          409,
          "ARTIFACT_NOT_RETRYABLE",
          "Artifact cannot be retried",
        );
      }
      response.status(202).json(success(request, { artifactId }));
    }),
  );
  return router;
}
