import type { TenantContext } from "../modules/tenant/tenant.types.js";

declare global {
  namespace Express {
    interface Request {
      authenticatedUserId?: string;
      tenantContext?: TenantContext;
    }
  }
}

export {};
