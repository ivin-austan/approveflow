# Phase 8 Security and Tenant-Isolation Review

## Review checklist

- Tenant-owned tables use `organization_id` and composite tenant foreign keys
  where records reference one another.
- Tenant context is resolved from the authenticated membership. Route
  organization parameters must equal that context and are never trusted as the
  source of authority.
- Repository queries for requests, approvals, dashboards, artifacts,
  notifications, and timelines include the active organization.
- Permissions are checked on the backend. Dashboard row scopes are reduced to
  explicit all, department, own, or assigned predicates.
- Approval commands lock tasks, stages, and requests and use idempotency
  records. System actions lock their scheduled action and runtime stage.
- Published workflow versions remain immutable; runtime stages retain their
  source version and snapshot display data.
- Artifact grants are random, hashed at rest, five-minute, single-use,
  audience-, tenant-, artifact-, and purpose-bound.
- Artifact bytes are SHA-256 checked before serving or attaching. Browser print
  uses the canonical stored bytes.
- Email jobs use stable provider idempotency keys and reconcile unknown provider
  outcomes before retrying. Current active membership, active user, verified
  email, and unchanged address are checked before submission.
- Sign-in links contain only an encoded same-origin `/organizations/...`
  application path. They contain no access, refresh, artifact, or approval
  bearer token.
- SQL values use Drizzle parameters or parameterized SQL templates. Sort fields
  are allowlisted. CSV output quotes every cell and is capped at 10,000 rows.
- API responses hide database errors and stack traces. Authentication failures
  are generic. Request bodies are limited and security headers deny framing and
  MIME sniffing.
- Logs redact authorization, cookies, passwords, refresh tokens, and generic
  token fields. Audit timeline payloads recursively remove email, token,
  password, secret, object-key, and storage-key fields.

## Required pre-release evidence

The checklist is not a substitute for tests. Release approval requires:

1. Real-PostgreSQL tenant-isolation and concurrent-decision tests against all
   migrations through the release migration.
2. Playwright journeys for onboarding, invitation, publication, submission,
   approval, return/resubmission, PDF delivery, dashboard export, print, and
   download.
3. An accessibility scan plus keyboard/manual review at desktop, tablet, and
   mobile breakpoints.
4. Dependency and container-image scans with critical findings resolved or
   explicitly accepted.
5. A restored encrypted backup with sampled artifact hashes verified.
6. Performance results recorded using the operations runbook.

## Evidence recorded to date

- The complete migration chain through `0010` applies to the dedicated local
  PostgreSQL test database.
- A real-PostgreSQL integration test verifies that a request cannot reference
  another tenant's workflow through the composite tenant foreign key, while the
  equivalent same-tenant insert succeeds.
- A real-PostgreSQL concurrent `ANY` decision test verifies request-first lock
  ordering, single stage advancement, single audit/outbox emission, safe replay,
  and rejection of an idempotency key reused with a different payload.
- The same PostgreSQL suite verifies concurrent `ALL` decisions retain both
  approvals while advancing once, and that a return closes the active round,
  increments the request revision, and commits its audit/outbox records.
- Returned-request resubmission preserves the immutable request number,
  supersedes the completed round, creates round 2, and restarts at the first
  applicable stage. A decisive rejection is also verified to close its round
  and atomically persist request, audit, and outbox state.
- Final approval after resubmission is verified to create exactly one canonical
  artifact for round 2, one initiator delivery snapshot, and one artifact
  generation outbox event. Replaying the final decision creates no duplicates;
  an ineligible recipient is snapshotted as permanently failed without
  reversing document approval.
- Formatting, linting, strict type checking, unit tests, production builds, and
  the authentication Playwright smoke tests pass locally.

## Known release blocker

The remaining real-PostgreSQL persistence, transaction, and concurrent-decision
matrix must be completed. One tenant-isolation constraint test and successful
migration execution do not yet satisfy that gate.
