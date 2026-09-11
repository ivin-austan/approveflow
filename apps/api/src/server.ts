import { parseServerEnvironment } from "@approveflow/config";
import { createDatabase } from "@approveflow/database";
import { createApp } from "./app.js";
import { JwtAccessTokenService } from "./modules/auth/access-token.js";
import { verifyPassword } from "./modules/auth/auth.crypto.js";
import { DrizzleAuthRepository } from "./modules/auth/auth.repository.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { DrizzleTenantRepository } from "./modules/tenant/tenant.repository.js";
import { createTenantRouter } from "./modules/tenant/tenant.routes.js";
import { hashPassword } from "./modules/auth/auth.crypto.js";
import { DrizzleOnboardingRepository } from "./modules/onboarding/onboarding.repository.js";
import { createOnboardingRouter } from "./modules/onboarding/onboarding.routes.js";
import { OnboardingService } from "./modules/onboarding/onboarding.service.js";
import { DrizzleAdministrationRepository } from "./modules/administration/administration.repository.js";
import { createAdministrationRouter } from "./modules/administration/administration.routes.js";
import { AdministrationService } from "./modules/administration/administration.service.js";
import { DrizzleWorkflowRepository } from "./modules/workflow/workflow.repository.js";
import { createWorkflowRouter } from "./modules/workflow/workflow.routes.js";
import { WorkflowService } from "./modules/workflow/workflow.service.js";
import { DrizzleWorkflowConfigurationRepository } from "./modules/workflow/configuration.repository.js";
import { createWorkflowConfigurationRouter } from "./modules/workflow/configuration.routes.js";
import { WorkflowConfigurationService } from "./modules/workflow/configuration.service.js";
import { DrizzleApproverOptionRepository } from "./modules/workflow/approver-options.repository.js";
import { createApproverOptionRouter } from "./modules/workflow/approver-options.routes.js";
import { ApproverOptionService } from "./modules/workflow/approver-options.service.js";

const environment = parseServerEnvironment(process.env);
const { db } = createDatabase(environment.DATABASE_URL);
const accessTokens = new JwtAccessTokenService(
  environment.ACCESS_TOKEN_SECRET,
  environment.ACCESS_TOKEN_TTL_MINUTES,
);
const authService = new AuthService(
  new DrizzleAuthRepository(db),
  { verify: verifyPassword },
  accessTokens,
  { refreshTokenTtlDays: environment.REFRESH_TOKEN_TTL_DAYS },
);
const tenantRepository = new DrizzleTenantRepository(db);
const administrationService = new AdministrationService(
  new DrizzleAdministrationRepository(db),
);
const workflowService = new WorkflowService(new DrizzleWorkflowRepository(db));
const workflowConfigurationService = new WorkflowConfigurationService(
  new DrizzleWorkflowConfigurationRepository(db),
);
const approverOptionService = new ApproverOptionService(
  new DrizzleApproverOptionRepository(db),
);
const app = createApp({
  webOrigin: environment.WEB_ORIGIN,
  authRouter: createAuthRouter({
    service: authService,
    production: environment.NODE_ENV === "production",
    refreshTokenTtlDays: environment.REFRESH_TOKEN_TTL_DAYS,
  }),
  tenantRouter: createTenantRouter(accessTokens, tenantRepository),
  onboardingRouter: createOnboardingRouter(
    new OnboardingService(new DrizzleOnboardingRepository(db), {
      hash: hashPassword,
    }),
  ),
  administrationRouter: createAdministrationRouter(
    administrationService,
    accessTokens,
    tenantRepository,
  ),
  workflowRouter: createWorkflowRouter(
    workflowService,
    accessTokens,
    tenantRepository,
  ),
  workflowConfigurationRouter: createWorkflowConfigurationRouter(
    workflowConfigurationService,
    accessTokens,
    tenantRepository,
  ),
  approverOptionRouter: createApproverOptionRouter(
    approverOptionService,
    accessTokens,
    tenantRepository,
  ),
});

app.listen(environment.API_PORT, environment.API_HOST, () => {
  process.stdout.write(
    `ApproveFlow API listening on ${environment.API_HOST}:${String(environment.API_PORT)}\n`,
  );
});
