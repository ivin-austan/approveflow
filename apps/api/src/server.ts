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
import { DrizzleRequestRepository } from "./modules/request/request.repository.js";
import { createRequestRouter } from "./modules/request/request.routes.js";
import { RequestService } from "./modules/request/request.service.js";
import { DrizzleApprovalRepository } from "./modules/approval/approval.repository.js";
import { createApprovalRouter } from "./modules/approval/approval.routes.js";
import { ApprovalService } from "./modules/approval/approval.service.js";
import { DrizzleArtifactRepository } from "./modules/artifact/artifact.repository.js";
import {
  ArtifactGrantService,
  ArtifactOperationsService,
} from "./modules/artifact/artifact.service.js";
import { FileSystemArtifactStorage } from "./modules/artifact/filesystem.storage.js";
import { createArtifactRouter } from "./modules/artifact/artifact.routes.js";
import { DrizzleDeliveryRepository } from "./modules/delivery/delivery.repository.js";
import { createDeliveryRouter } from "./modules/delivery/delivery.routes.js";
import { DeliveryOperationsService } from "./modules/delivery/delivery.service.js";
import { DrizzleDashboardRepository } from "./modules/dashboard/dashboard.repository.js";
import { createDashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { DashboardService } from "./modules/dashboard/dashboard.service.js";
import { DrizzleAuditRepository } from "./modules/audit/audit.repository.js";
import { createAuditRouter } from "./modules/audit/audit.routes.js";
import { AuditService } from "./modules/audit/audit.service.js";

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
const requestService = new RequestService(new DrizzleRequestRepository(db));
const approvalService = new ApprovalService(new DrizzleApprovalRepository(db));
const artifactRepository = new DrizzleArtifactRepository(db);
const artifactStorage = new FileSystemArtifactStorage(
  environment.ARTIFACT_STORAGE_PATH,
);
const deliveryRepository = new DrizzleDeliveryRepository(db);
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
  requestRouter: createRequestRouter(
    requestService,
    accessTokens,
    tenantRepository,
  ),
  approvalRouter: createApprovalRouter(
    approvalService,
    accessTokens,
    tenantRepository,
  ),
  artifactRouter: createArtifactRouter(
    new ArtifactGrantService(artifactRepository),
    new ArtifactOperationsService(artifactRepository),
    artifactStorage,
    accessTokens,
    tenantRepository,
  ),
  dashboardRouter: createDashboardRouter(
    new DashboardService(new DrizzleDashboardRepository(db)),
    accessTokens,
    tenantRepository,
  ),
  deliveryRouter: createDeliveryRouter(
    new DeliveryOperationsService(deliveryRepository),
    accessTokens,
    tenantRepository,
  ),
  auditRouter: createAuditRouter(
    new AuditService(new DrizzleAuditRepository(db)),
    accessTokens,
    tenantRepository,
  ),
});

app.listen(environment.API_PORT, environment.API_HOST, () => {
  process.stdout.write(
    `ApproveFlow API listening on ${environment.API_HOST}:${String(environment.API_PORT)}\n`,
  );
});
