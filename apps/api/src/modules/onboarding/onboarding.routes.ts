import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler, HttpError, success } from "../../lib/http.js";
import {
  OnboardingConflictError,
  type OnboardingService,
} from "./onboarding.service.js";

const onboardingSchema = z
  .object({
    email: z.email().max(320),
    password: z
      .string()
      .min(12)
      .max(256)
      .regex(/[a-z]/, "Must contain a lowercase letter")
      .regex(/[A-Z]/, "Must contain an uppercase letter")
      .regex(/[0-9]/, "Must contain a number"),
    fullName: z.string().trim().min(1).max(120),
    organizationName: z.string().trim().min(1).max(120),
    organizationSlug: z
      .string()
      .trim()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export function createOnboardingRouter(service: OnboardingService): Router {
  const router = Router();
  router.post(
    "/",
    rateLimit({ windowMs: 60 * 60 * 1000, limit: 5 }),
    asyncHandler(async (request, response) => {
      const parsed = onboardingSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", {
          fields: z.flattenError(parsed.error).fieldErrors,
        });
      }
      try {
        const result = await service.createOrganizationAccount(parsed.data);
        response.status(201).json(success(request, result));
      } catch (error) {
        if (error instanceof OnboardingConflictError) {
          throw new HttpError(
            409,
            "ONBOARDING_CONFLICT",
            "Unable to create account",
          );
        }
        throw error;
      }
    }),
  );
  return router;
}
