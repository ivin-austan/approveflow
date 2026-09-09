# API application instructions

Follow the repository-root `AGENTS.md` in addition to these rules.

## Stack

- Use Node.js, Express and strict TypeScript.
- Use PostgreSQL.
- Use Drizzle ORM for database access.
- Use Zod for external-input validation.
- Use Pino for structured logging.
- Use Vitest and Supertest for testing.
- Expose OpenAPI documentation.
- Use Redis and BullMQ for background jobs.

Do not introduce another API framework, ORM or database without approval.

## Module architecture

Organize the API by business module.

A module may contain:

- routes
- controller
- validation schemas
- application services
- domain services
- authorization policies
- repository interfaces
- repository implementations
- errors
- tests

Keep dependency direction explicit:

route → controller → application service → repository/domain service

Controllers must not:

- Query the database directly
- Contain workflow business logic
- Make authorization decisions independently
- Return raw database records without response mapping

## Request processing

For every protected endpoint:

1. Authenticate the user.
2. Resolve the active organization.
3. Verify active organization membership.
4. Validate params, query and body.
5. Enforce the required permission.
6. Execute the application service.
7. Return the standardized response.

Never trust `organizationId`, membership IDs, roles, permissions or ownership
claims received from the client.

## Validation

- Validate all external input with Zod.
- Reject unknown properties where appropriate.
- Normalize data deliberately rather than silently.
- Keep request and response schemas distinct.
- Do not pass request bodies directly to Drizzle insert or update methods.
- Map allowed properties explicitly to prevent mass assignment.
- Return consistent field-level validation errors.

## Database access

- Database access belongs in repositories or the database package.
- Use Drizzle for normal database operations.
- Use parameterized raw SQL only when it is clearer or more capable.
- Never construct SQL using string concatenation.
- Scope every tenant-owned query by `organization_id`.
- Use transactions for multi-record state changes.
- Add constraints and indexes rather than depending only on application code.
- Avoid N+1 queries.
- Paginate collection endpoints.
- Explain and test raw SQL.

## Authentication

- Hash passwords with Argon2id.
- Use short-lived access tokens.
- Rotate refresh tokens.
- Store only hashed refresh tokens.
- Support token and session revocation.
- Use secure HTTP-only cookies for browser refresh tokens.
- Apply rate limiting to authentication endpoints.
- Return generic login failures.
- Never log passwords or tokens.

## Authorization

- Deny access by default.
- Verify organization membership before permissions.
- Use granular permissions.
- Do not authorize only by role-name string comparison.
- Enforce ownership rules in services or policies.
- Never depend on frontend visibility for security.
- Treat tenant leakage as a critical security defect.

## Workflow engine

- Published workflow versions are immutable.
- Validate workflow definitions before publication.
- Never execute user-provided JavaScript.
- Use the validated condition evaluator.
- Resolve approvers to specific memberships during submission.
- Keep valid state transitions centralized.
- Reject invalid or stale approval actions.
- Make submission and approval actions idempotent.

## Transactions and concurrency

- Use a PostgreSQL transaction for request submission.
- Use a transaction for every approval decision.
- Protect runtime state with conditional atomic updates or row locks.
- Ensure duplicate or concurrent actions cannot advance a request twice.
- Keep transactions focused and reasonably short.
- Do not send email or upload files inside database transactions.
- Create durable notification/outbox records within the transaction.
- Process external side effects after commit.

## Audit trail

Create append-only audit events for important actions.

Audit events must include appropriate identifiers, actor, organization,
event type and timestamp.

Do not place secrets, tokens, passwords, attachment contents or unnecessary
sensitive values in audit metadata.

Never update or delete audit events through normal application operations.

## Error handling

- Use typed application errors.
- Handle errors centrally.
- Map errors to appropriate HTTP status codes.
- Include request/correlation IDs.
- Never return stack traces in production.
- Never expose raw PostgreSQL or Drizzle errors.
- Do not silently catch and ignore errors.
- Log operational failures with sufficient safe context.

## API contracts

- Place endpoints under `/api/v1`.
- Use consistent resource naming.
- Use consistent response envelopes.
- Support pagination, filtering and sorting where relevant.
- Maintain OpenAPI documentation.
- Treat changes to public response structures as API-contract changes.
- Use idempotency keys for submission and approval actions.
- Do not expose internal security or database fields.

## Background work

Queue asynchronous work for:

- Email delivery
- Reminders
- Escalations
- Overdue processing
- Expensive PDF generation

Jobs must be:

- Typed
- Idempotent
- Retryable
- Observable
- Safe against duplicate execution

## Testing

Use Vitest and Supertest.

Prioritize integration tests with a real test PostgreSQL database for:

- Tenant isolation
- Permission enforcement
- Workflow publication and versioning
- Dynamic-field validation
- Request submission
- Sequential approvals
- Parallel approvals
- Rejection
- Return and resubmission
- Idempotency
- Concurrent approval actions
- Feature-entitlement enforcement
- Refresh-token rotation

Mocks should not replace database transaction or concurrency testing.

## Verification

After API changes, run the applicable commands for:

- Formatting
- Linting
- Type checking
- Unit tests
- Integration tests
- Production API build

Report any command that could not be run.
