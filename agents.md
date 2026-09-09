# AGENTS.md

## Project overview

ApproveFlow is a multi-tenant approval-workflow SaaS for SMEs.

Organizations can create dynamic request forms, configure approval stages,
assign approvers, apply conditional rules and track requests through an
auditable approval process.

## Required architecture

- Use a pnpm and Turborepo monorepo.
- Use a modular-monolith architecture.
- Do not introduce microservices without explicit approval.
- Keep applications inside `apps/`.
- Keep reusable packages inside `packages/`.
- Avoid circular dependencies between workspace packages.

## Technology

### Frontend

- React 19
- TypeScript strict mode
- Vite
- React Router
- Tailwind CSS
- shadcn/ui
- TanStack Query
- TanStack Table
- React Hook Form
- Zod
- dnd-kit
- Recharts
- Vitest

### Backend

- Node.js
- Express
- TypeScript strict mode
- PostgreSQL
- Drizzle ORM
- Zod
- Pino
- Redis
- BullMQ
- Vitest and Supertest

Do not introduce alternative frameworks or ORMs without approval.

## Database rules

- PostgreSQL is the primary database.
- Use Drizzle for schema definitions, migrations and standard queries.
- Keep database access inside repositories or database modules.
- Do not execute SQL from routes or controllers.
- Parameterized raw SQL is allowed for complex PostgreSQL operations.
- Never concatenate untrusted values into SQL.
- Use transactions for multi-step state changes.
- Use `timestamptz` for timestamps.
- Use decimal/numeric types for money.
- Add indexes according to query patterns.
- Do not make destructive schema changes without explicit approval.
- Generate migrations; never use schema push against production.

## Multi-tenancy

- Every tenant-owned record must include `organizationId`.
- Never trust an organization ID received directly from the client.
- Resolve the active organization from an authenticated membership.
- Scope every tenant query to the active organization.
- Treat missing tenant filtering as a security vulnerability.
- Never expose data belonging to another organization.
- Add tenant-isolation tests for new tenant-owned features.

## Authorization

- Enforce authorization in the backend.
- UI visibility is not an authorization control.
- Use granular permissions instead of hard-coded role-name comparisons.
- Deny access by default.
- Check both organization membership and required permission.
- Do not allow users to approve their own requests unless the workflow
  explicitly permits it.

## Workflow rules

- Published workflow versions are immutable.
- Editing a published workflow creates a new draft version.
- Existing requests remain attached to their original workflow version.
- Never execute user-provided JavaScript.
- Evaluate conditions through the validated condition engine.
- Define valid request and approval transitions centrally.
- Reject invalid transitions on the backend.

## Approval-engine rules

- Use PostgreSQL transactions for request submission and approval decisions.
- Make submission and approval actions idempotent.
- Protect approval actions against concurrent updates.
- Do not send emails or call external storage inside database transactions.
- Queue notifications only after a successful transaction.
- Every important action must create an audit event.
- Audit events are append-only.

## Backend organization

Use the following structure within a backend feature:

- route
- controller
- validation schema
- application/domain service
- repository
- authorization policy
- tests

Controllers should:

- Read validated input
- Call application services
- Return standardized responses

Controllers must not contain complex business logic or direct database queries.

## API rules

- Use REST endpoints under `/api/v1`.
- Validate params, queries and bodies with Zod.
- Use consistent success and error responses.
- Support pagination for collection endpoints.
- Never return stack traces or raw database errors.
- Never expose sensitive internal fields.
- Update OpenAPI documentation when changing an API contract.
- Use idempotency keys for submission and approval endpoints.

## Frontend organization

Organize frontend code by product feature.

Separate:

- Page components
- Feature components
- Query and mutation hooks
- API clients
- Form schemas
- Reusable UI components

Rules:

- Do not make API requests directly inside presentation components.
- Use TanStack Query for server state.
- Use React Hook Form and Zod for forms.
- Use Zustand only for genuine shared client state.
- Do not duplicate backend business rules in the frontend.
- Do not use `any`.
- Handle loading, empty, error and success states.
- Keep components focused and reasonably sized.

## UI standards

- Build a professional and responsive B2B SaaS interface.
- Use accessible semantic HTML.
- All interactive elements must be keyboard accessible.
- Use consistent status colors and labels.
- Use skeletons for meaningful loading states.
- Confirm destructive or irreversible actions.
- Do not use excessive gradients or animations.
- Do not use placeholder metrics after API integration.
- Design approval actions for desktop and mobile.

## Security

- Never commit credentials, tokens or environment secrets.
- Do not log passwords, tokens or sensitive attachment data.
- Validate all external input.
- Use Argon2id for passwords.
- Store refresh tokens securely and rotate them.
- Apply rate limiting to authentication and sensitive endpoints.
- Validate attachment size and type.
- Protect against mass assignment.
- Use generic authentication-error responses.
- Treat authorization failures and tenant leaks as critical defects.

## TypeScript standards

- Enable strict TypeScript.
- Avoid `any`, unsafe casts and non-null assertions.
- Prefer explicit domain types.
- Use exhaustive checks for state and status handling.
- Avoid duplicating shared constants as string literals.
- Export only what another module genuinely needs.
- Do not suppress compiler or linting errors without justification.

## Testing expectations

Add tests for business-critical behavior, including:

- Tenant isolation
- Authorization
- Workflow versioning
- Form validation
- Condition evaluation
- Request submission
- Sequential approvals
- Parallel approvals
- Return and resubmission
- Rejection
- Idempotency
- Concurrent actions
- Disabled feature enforcement

Prefer integration tests with a real test PostgreSQL database for persistence,
transaction and concurrency behavior.

Avoid low-value snapshot testing.

## Change discipline

Before modifying code:

1. Inspect relevant files.
2. Read applicable documentation.
3. Check for uncommitted user changes.
4. Explain any important assumption.

While modifying code:

- Make focused changes.
- Preserve unrelated work.
- Do not rewrite working modules unnecessarily.
- Do not add dependencies when existing packages can solve the problem.
- Do not change public API contracts silently.
- Update tests and documentation with behavior changes.

After modifying code:

1. Run formatting.
2. Run linting.
3. Run type checking.
4. Run relevant tests.
5. Run affected production builds.
6. Fix failures caused by the change.
7. Summarize changed files and verification results.

## Prohibited actions

Do not perform any of the following without explicit approval:

- Deploying the application
- Modifying production infrastructure
- Running production migrations
- Deleting production or user data
- Force-pushing Git branches
- Rewriting Git history
- Adding a new framework, ORM or database
- Changing the approved architecture
- Disabling security checks
- Removing failing tests merely to make CI pass

## Working method

- Implement one focused feature or phase at a time.
- Present significant architecture decisions before implementing them.
- State tradeoffs clearly.
- Ask for clarification when a decision would materially affect the product.
- Do not claim completion if tests or builds are failing.
- At completion, provide a concise summary and a Conventional Commit message.
