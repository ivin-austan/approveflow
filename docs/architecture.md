# ApproveFlow Architecture

## Document status

- Phase: 1 - product and technical design
- Status: awaiting approval
- Style: pnpm/Turborepo modular monolith

## Architectural principles

- Applications live in `apps/`; reusable packages live in `packages/`.
- The API is one deployable modular monolith, not a collection of services.
- React presentation code never owns backend business rules.
- Published workflow versions are immutable.
- Request status is separate from dynamically configured approval stages.
- Tenant context is established by authenticated membership and is mandatory at
  repository boundaries.
- Submission and approval decisions are transactional and idempotent.
- External effects occur after commit through a durable outbox.

## Proposed workspace

```text
approveflow/
|-- apps/
|   |-- web/
|   `-- api/
|-- packages/
|   |-- contracts/
|   |-- database/
|   |-- domain/
|   |-- config/
|   |-- logger/
|   |-- pdf/
|   |-- ui/
|   `-- test-utils/
|-- tooling/
|-- package.json
|-- pnpm-workspace.yaml
`-- turbo.json
```

Package responsibilities:

- `apps/web`: React 19 SPA, React Router routes, product features, and typed API
  integration.
- `apps/api`: Express composition root, HTTP middleware, business modules, and
  BullMQ workers.
- `packages/contracts`: public request/response schemas and safe shared
  constants. It contains no persistence models.
- `packages/database`: Drizzle schema, generated migrations, database client,
  and transaction helpers.
- `packages/domain`: framework-independent condition evaluation, workflow
  validation, state transitions, and domain types.
- `packages/config`: strict environment validation.
- `packages/logger`: shared Pino configuration and redaction.
- `packages/pdf`: isomorphic approved-statement document model and jsPDF-based
  renderer used by backend generation and permitted browser previews.
- `packages/ui`: reusable shadcn/ui-based presentation components.
- `packages/test-utils`: test database lifecycle, factories, and fixtures.

Allowed dependency direction:

```text
web -> contracts, pdf, ui
api -> contracts, domain, database, config, logger, pdf
database -> domain-compatible primitives
domain -> no application or infrastructure package
```

No package imports from an application, and cross-package circular dependencies
are prohibited.

## API modular monolith

Business modules under `apps/api/src/modules` are:

- `auth`
- `organizations`
- `departments`
- `memberships`
- `authorization`
- `document-types`
- `business-calendars`
- `numbering`
- `workflows`
- `requests`
- `approvals`
- `audit`
- `notifications`
- `documents`
- `pdf-artifacts`
- `entitlements`

Each module follows this dependency flow:

```text
route -> controller -> application service -> domain service/repository
```

A module can contain routes, controllers, Zod validation, application and
domain services, policies, repository interfaces and implementations, typed
errors, response mappers, and tests. Controllers only read validated input,
invoke an application service, and map the result.

Cross-module work uses explicit application interfaces or typed in-process
domain events. A transaction spanning workflow runtime tables is coordinated by
one application service and one PostgreSQL connection. Splitting this work into
services would weaken the required transaction boundary and is not proposed.

## Protected request pipeline

For every protected endpoint:

1. Assign or accept a valid correlation ID.
2. Authenticate the user and session.
3. Resolve the active organization from the route and authenticated user.
4. Verify an active membership in that organization.
5. Parse and validate route params, query, headers, and body with Zod.
6. Enforce granular permissions and the resource policy.
7. Invoke an application service with trusted tenant context.
8. Map the domain result into a public response schema.
9. Map errors centrally and log only safe context.

The client-provided organization ID is a lookup claim, never trusted tenant
context. The verified membership supplies `organizationId` and `membershipId`
to application and repository operations.

## Frontend architecture

```text
apps/web/src/
|-- app/
|-- routes/
|-- features/
|   |-- auth/
|   |-- organizations/
|   |-- members/
|   |-- workflows/
|   |-- requests/
|   `-- approvals/
|-- components/
|-- hooks/
|-- api/
|-- lib/
`-- types/
```

- Route components are thin.
- Presentation components do not call `fetch` or Axios.
- Typed API functions and TanStack Query hooks own server access and state.
- Query keys include active organization scope.
- React Hook Form and Zod manage forms.
- Workflow-builder state is separate from persisted workflow data.
- dnd-kit uses stable stage/field IDs and provides keyboard reordering.
- Zustand is introduced only for demonstrated shared client state.
- Loading, empty, error, permission-denied, and success states are explicit.

## Dynamic workflow definition

### Definition model

A document type owns one versioned workflow and its configurable code,
numbering, business calendar, and automatic-approval defaults. Each published
workflow version snapshots the effective policies used by future submissions
and owns ordered form sections, fields, and approval stages. Each stage contains:

- An organization-defined name, description, and instructions.
- A contiguous `position` controlling sequential execution.
- A completion policy of `ANY` or `ALL`.
- One or more typed approver assignment rules.
- An optional activation condition.
- Optional business-time due duration, reminders, and escalations.

There is no stage-level sequential/parallel mode. Stages always execute one at a
time by position. Multiple approval tasks within the active stage are available
in parallel.

There is no `isFinal` definition flag. The last applicable stage is determined
after condition evaluation for a specific submission.

### Condition engine

Conditions are a bounded, validated abstract syntax tree:

```ts
type Condition =
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition }
  | {
      kind: "comparison";
      fieldId: string;
      operator: ComparisonOperator;
      value: ConditionValue;
    };
```

The implementation defines exact operator/value pairs per field type. It
enforces maximum depth and node count. The same pure evaluator can power web
preview and backend validation, but the backend evaluation is authoritative.

### Approver assignment resolution

At request submission, the backend resolves each applicable stage assignment:

- `MEMBERSHIP`: resolve the referenced active membership.
- `ROLE`: find every active membership holding the referenced organization
  role.
- `DEPARTMENT_ROLE`: find every active membership belonging to the selected
  department and holding the role. A membership may belong to multiple
  departments.
- `REQUESTER_MANAGER`: resolve the requester's active reporting-manager
  membership.
- `FORM_FIELD_USER`: validate and resolve the active membership selected by the
  document initiator in the configured member field. This assignment ships in
  the initial MVP.

All references must match the request organization. Duplicate memberships from
multiple rules are deduplicated. If an applicable stage resolves to zero active
approvers, submission fails atomically with a safe configuration error.

Invitation references are draft-only. Acceptance converts the draft assignment
to an active membership reference through an authorized workflow application
operation. Publication refuses unresolved invitations.

## Department and document-type numbering

Each document has a UUID for internal identity and, after formal submission, an
immutable business number. The initiator belongs to one or more departments but
selects exactly one originating department for the document. The backend
validates that selection from trusted membership data.

The default allowlisted pattern is:

```text
{DEPARTMENT_CODE}/{DOCUMENT_TYPE_CODE}/{YEAR}/{SEQUENCE}
```

Number generation is a database application service within the submission
transaction. It locks or atomically upserts a sequence scoped by organization,
originating department, document type, and calendar year; increments it; renders
the snapshotted codes and padded value; and inserts an append-only allocation.
A unique `(organization_id, document_number)` constraint is the final duplicate
barrier. Allocation rows survive any later permitted document deletion, so an
issued number can never be reused.

Only allowlisted components can appear in numbering formats. Code changes apply
to future submissions and do not rewrite allocated numbers. `{YEAR}` uses the
configured business-calendar timezone, and a code used in an allocation remains
reserved to its original department or document type.

## Business calendars

Each organization defines at least one business calendar with timezone, working
week, daily work windows, and holidays. A document type selects a calendar or
inherits the organization default. The domain calendar service calculates due,
reminder, escalation, and automatic-approval timestamps in business time and
persists the resulting UTC `timestamptz` deadline plus the calendar/version
snapshot used for reproducibility.

## Runtime approval journey

Submission performs the following work in one PostgreSQL transaction:

1. Claim or replay the idempotency record.
2. Lock the draft request and validate its lifecycle state.
3. Validate the single originating department against the initiator's active
   department memberships.
4. Validate answers against the published workflow version.
5. Lock or atomically create the department/document-type/year sequence row.
6. Allocate the immutable human-readable document number and append its
   permanent allocation record.
7. Append the durable logical `SUBMITTED` audit event.
8. Evaluate all stage activation conditions.
9. Fail if no stage applies and no-stage automatic approval is disabled.
10. Resolve each applicable assignment to active memberships.
11. Create a new approval round and immutable runtime stage snapshots.
12. Mark the last applicable runtime stage as final.
13. Create specific-member tasks and activate the first stage.
14. Set current status to `IN_REVIEW`, or to `APPROVED` for permitted no-stage
    automatic approval.
15. Append remaining audit and outbox records.
16. Store the idempotent response and commit.

`SUBMITTED` is durable in the audit history, while the current row reaches
`IN_REVIEW` in the same transaction. A rollback consumes neither a document
number nor a sequence allocation.

Runtime shape:

```text
Request
  -> Approval round
      -> Stage instance 1 (active/completed)
          -> Approval task per resolved membership
      -> Stage instance 2 (waiting)
          -> Approval task per resolved membership
      -> Final applicable stage instance (waiting)
          -> Approval task per resolved membership
```

Only the active stage accepts decisions. Later tasks may be created in a
`WAITING` state or created upon activation; the proposed design creates them at
submission so the resolved path and identities are immutable, but exposes them
only when their stage becomes active.

## Decision processing

Each approve, reject, or return command is handled in a transaction:

1. Claim or replay its idempotency record.
2. Lock the task, stage, and request in a consistent order.
3. Verify tenant, permission, assignment, current round, and `PENDING` state.
4. Enforce the workflow version's self-approval policy.
5. Persist the decision and snapshot-safe comment.
6. Recalculate the stage under `ANY` or `ALL`.
7. Skip redundant pending tasks after `ANY` succeeds.
8. Activate the next stage or transition the request to a terminal state.
9. Append audit and outbox records.
10. Store the idempotent response and commit.

An `ANY` approval completes the stage once one assigned member approves. An
`ALL` stage completes only when all non-skipped tasks approve. A valid rejection
immediately rejects the request, and a valid return immediately transitions it
to `RETURNED`, closes remaining tasks, and gives responsibility back to the
initiator. It does not create an approval task for the initiator. Conditional
atomic updates or row locks plus unique constraints prevent two decisions from
advancing the same request twice.

Resubmission always creates a new approval round. It reevaluates the full path
and current eligible memberships and restarts at the first applicable stage;
prior rounds remain immutable.

Changes to roles, departments, reporting managers, or membership status do not
silently rewrite an existing runtime path. An explicit reassignment command
locks the pending task and stage, verifies permission and the replacement active
same-tenant membership, marks the old task as reassigned, creates a linked
replacement task, appends an audit event, and queues the standard assignment
email in one transaction.

## Final-stage behavior

`request_stage_instances.is_final_applicable` is a runtime snapshot, not a
workflow-definition setting. When the stage bearing that marker completes:

- The stage becomes `COMPLETED` for a human decision or `AUTO_APPROVED` for a
  system deadline action.
- The request becomes `APPROVED`.
- The final decision and request transition are audited.
- One pending canonical PDF artifact and its generation outbox event are
  written. The final email is queued only after that artifact becomes ready.

Reordering a later draft has no effect on an existing request. Resubmission
always creates a new approval round, reevaluates the complete applicable path
from current document answers, and starts again at its first applicable stage.

## Workflow builder and preview

The `Approval Stages` builder displays ordered cards with custom stage content,
assignments, completion policy, activation condition, due duration, reminders,
escalations, and validation results. The final card in a concrete preview is
labeled `Final approval stage`.

Preview runs the condition evaluator against representative answers and shows:

```text
Draft -> Submitted -> configured applicable stages -> Approved
```

Conditional stages show included, excluded, and unresolved preview states. The
preview never substitutes for backend publication or submission validation.

## Notifications and scheduled work

Transactions create durable outbox records only. BullMQ workers perform email,
reminder, escalation, overdue, and future expensive-document work after commit.

Stage activation produces one deduplicated assignment event per resolved
membership. The email renderer receives a minimal typed payload and loads
current safe data where appropriate. Human and system stage completion activate
the next stage in the same transaction and create its notification events.
Review links point to the document approval route and do not contain bearer
credentials.

If the recipient is not authenticated, the web application preserves a
validated same-origin return path through sign-in and then opens the document's
approval page. The API always rechecks tenant membership, task assignment, and
current task state.

When an active stage exceeds the document type's snapshotted automatic-approval
threshold, a scheduled system command completes the stage without impersonating
a member. It records `System Auto-Approved`, skips remaining tasks, and follows
the ordinary next-stage or final-completion notification path.

Escalation actions are limited to notifications and `RETURN_TO_INITIATOR`. The
latter moves the request to `RETURNED` and closes the current round; it is not a
self-approval or arbitrary approver reassignment.

Jobs are typed, idempotent, retryable, observable, and safe against duplicate
execution. A scheduler enqueues due reminders and escalations based on runtime
stage deadlines and policy snapshots.

## Approved-PDF and final-delivery pipeline

The browser does not generate the canonical emailed approval artifact. Final
approval uses this sequence:

```text
Final approval transaction
  -> mark request APPROVED
  -> append final approval audit event
  -> insert one PENDING PDF artifact row
  -> snapshot eligible recipients and insert logical delivery records
  -> write PDF_GENERATION_REQUESTED outbox event
  -> commit

PDF worker
  -> claim artifact with a lease
  -> load immutable approved document/approval snapshot
  -> build a bounded PDF model
  -> render with jsPDF
  -> store at a deterministic tenant-scoped object key
  -> record hash, size, generation time, and READY status
  -> create email outbox events for existing eligible delivery records

Email worker
  -> claim the delivery record
  -> load the verified initiator address and canonical PDF
  -> attach it when within the provider limit, otherwise include a secure link
  -> submit using the delivery deduplication key
  -> record provider ID, attempts, and DELIVERED or failure status
```

The artifact uniqueness key is the organization, request, approval round,
final-approval event, artifact type, and renderer version. The delivery
uniqueness key additionally includes the recipient membership and template
version. Retries update the same records rather than creating new logical sends;
a later valid round produces a new immutable artifact.

To satisfy one-email semantics across process crashes, the email adapter must
use a provider idempotency key when available. If a provider cannot guarantee
idempotency, the worker uses a send lease and reconciliation state, but a crash
after provider acceptance and before acknowledgement can never be proven
exactly-once without provider support. Provider selection must therefore prefer
idempotent send support.

PDF or email failure never rolls back or downgrades approval. Generation and
delivery have separate statuses, bounded retries, safe error codes, next-attempt
timestamps, and operator-visible manual retry. A deterministic storage key makes
generation retry safe if storage succeeds before the database update.

The PDF uses a shared typed document model and includes the approved marker,
document identity, originating department, initiator, approved form data,
workflow version, applicable stages, decision history, system auto-approvals,
and timestamps. The model excludes secrets and fields outside the published
document-type artifact policy. Because one canonical artifact is
shared, access is granted only to users authorized to see its complete content.
Rendering is paginated and size-bounded for email attachment limits.

### Artifact state machine

```text
PENDING -> GENERATING -> READY
                    `-> FAILED -> PENDING (automatic/manual retry)
GENERATING -> PENDING (expired lease recovery)
READY | FAILED -> DELETED (retention process)
DELETED (terminal)
```

The default generation lease is 10 minutes and is renewable by the owning
worker. Automatic generation attempts are limited to five with jittered backoff
of approximately 1 minute, 5 minutes, 15 minutes, 1 hour, and 6 hours. After
exhaustion the artifact remains `FAILED`. A user holding `approved_pdf.retry`
can move the same artifact from `FAILED` to `PENDING`; the action is rate-limited
and audited. A `READY` artifact is immutable and is never regenerated in place.
A new approval round or renderer version creates a new artifact.

### Delivery state machine

```text
PENDING -> SENDING -> DELIVERED
                   |-> FAILED -> PENDING (automatic/manual retry)
                   `-> PERMANENTLY_FAILED
SENDING -> SENDING (provider reconciliation while acceptance is unknown)
DELIVERED -> PERMANENTLY_FAILED (later hard-bounce/rejection callback)
PERMANENTLY_FAILED -> PENDING (authorized reopen after cause is corrected)
```

The default send lease is 10 minutes. Confirmed retryable failures receive at
most eight automatic submissions with jittered backoff of approximately 1
minute, 5 minutes, 15 minutes, 1 hour, 6 hours, 12 hours, 24 hours, and 48 hours.
Exhaustion, a hard bounce, provider rejection, or an ineligible recipient sets
`PERMANENTLY_FAILED` and stops automatic retries. `approved_pdf.retry` permits an
audited reopen of the same logical delivery only after recipient/provider
preconditions are valid.

`DELIVERED` means the provider accepted the message and no later permanent
failure is known. Exactly one logical delivery record is guaranteed. Provider
submission is at least once; the adapter supplies the logical delivery key as a
provider idempotency key where supported. On a timeout with unknown acceptance,
the record stays `SENDING` and a reconciliation job queries provider state or
waits for a callback before any resubmission. Soft bounces follow provider retry
policy; hard bounces and definitive rejections become `PERMANENTLY_FAILED`.

### Recipient and attachment policy

At final approval, the system selects only the initiator's current verified
account email and snapshots it into the delivery record. The initiator must have
an active membership in the document organization. It never sends to the
submission-time address as a second recipient. Suspended, inactive, or
unverified initiators generate a `PERMANENTLY_FAILED` delivery without a provider
call.

The email worker rechecks active membership and confirms that the snapshot is
still the current verified address immediately before submission. A later
suspension, unverification, or email change stops the send and records
`PERMANENTLY_FAILED`. An authorized reopen updates the same record to the newly
verified current address after the cause is resolved.

Configured completion recipients receive a secure authenticated link only, not
the PDF attachment. They must also resolve to active memberships with current
verified emails; authorization to the document is rechecked when the link is
opened. If the canonical PDF exceeds the provider-specific
attachment threshold (default 10 MiB), the eligible initiator also receives a
secure link without an attachment. Delivery mode and omission reason are
recorded.

### Canonical rendering contract

The PDF model contains organization and document type, immutable reference,
initiator and originating department, submitted values, workflow name/version,
all applicable stages, approver names, decisions, comments and timestamps,
system auto-approval attribution, final approval statement/time, artifact
ID, source-manifest hash, renderer version, generation time, and page numbering.
The final byte SHA-256 is stored as artifact metadata and shown by the dashboard,
not embedded into the bytes it hashes.

Approver names and decision records are typed/generated approval evidence, not
handwritten or cryptographic signatures. Fonts are embedded and version-pinned,
using Noto families for supported scripts. Rendering must support Unicode, RTL
shaping, long-content pagination, split tables with repeated headers, stable
header/footer layout, selectable text, language/title metadata, logical reading
order, and sufficient contrast.

PDF/UA-1 is the accessibility target. The early renderer spike must validate
tagged structure and assistive-technology behavior; jsPDF remains approved only
if it can meet the accepted canonical-artifact criteria, otherwise an alternative
requires explicit approval.

Only a validated size-bounded PNG/JPEG organization logo may be loaded from
private storage; remote images, SVG, scripts, and user document attachments are
not embedded. The canonical limit is 500 pages and 20 MiB. Determinism requires
stable ordering, snapshotted locale/timezone, fixed metadata and generation
timestamp, pinned fonts, and disabled random identifiers so a retry produces the
same bytes and SHA-256 hash. jsPDF backend, Unicode/RTL, accessibility tagging,
and deterministic-byte behavior receive an early technical spike. Failure to
meet acceptance criteria requires approval before choosing another renderer.

## Document-type dashboards

The web app exposes one route pattern such as
`/document-types/:documentTypeId/documents`, producing a separate tenant-scoped
dashboard for each document type. This is a reusable React feature, not generated
or hard-coded application pages.

Each dashboard uses TanStack Query and TanStack Table with query keys containing
the active organization and document type. It shows real status counts,
paginated documents, approval progress, PDF generation state, delivery state,
and permission-aware management actions.

Backend policies build the dashboard as the union of `request.read_all`,
`request.read_department`, `request.read_own`, and
`approval.read_assigned` scopes. PDF/delivery failure details and retry controls
require `approved_pdf.retry`; ordinary artifact access additionally requires
`approved_pdf.read` and visibility of the underlying document.

The default dashboard uses current calendar year, excludes cancelled documents,
sorts by `updated_at` descending, and uses cursor pagination with 25 rows and a
maximum page size of 100. Metrics use the identical filter/authorization scope.
Document-type administrators choose default columns from safe system columns
and explicitly non-sensitive form fields. CSV export applies the same policies,
is audited, and is capped at 10,000 rows.

For approved documents, **View PDF**, **Print PDF**, and **Download PDF** fetch
the canonical artifact through an authorized API. Browser printing uses the
canonical PDF. jsPDF may render a clearly labeled client-side preview from the
same typed PDF model, but a client artifact cannot replace the canonical stored
artifact or be used as proof of approval.

**Print PDF** remains disabled until `READY`, opens the canonical bytes through
the browser print dialog, and records a `PDF_PRINT_REQUESTED` access event. It
never runs the jsPDF renderer.

## Observability and operations

- Pino structured logs with correlation, organization, membership, request,
  job, and safe entity identifiers.
- Redaction for authorization headers, cookies, passwords, tokens, answers, and
  invitation secrets.
- Liveness and readiness endpoints.
- Metrics for API latency/errors, transaction retries, queue depth, job
  failures, stage ageing, notification delivery, PDF generation latency/failure,
  email queue age/failure, retry exhaustion, stuck outbox/leases, hash mismatch,
  and dashboard query latency.
- Alerts use environment-specific thresholds for retry exhaustion, old outbox
  records, expired unrecovered leases, repeated hash mismatch, sustained email
  queue age, and dashboard latency/error-rate objectives.
- OpenAPI documentation derived from maintained public schemas.

## Testing strategy

- Unit tests for condition evaluation, workflow validation, completion policy,
  and transition tables.
- API integration tests with real PostgreSQL for tenant isolation,
  authorization, versioning, assignment resolution, idempotency, and
  concurrency.
- Supertest for HTTP validation and response contracts.
- React Testing Library for builder behavior, accessible reordering, dynamic
  path preview, and approval availability.
- Playwright for onboarding, invitation, workflow publication, request
  submission, multi-stage approval, rejection, return, resubmission,
  document-type dashboards, and canonical PDF view/print/download.
- Worker integration tests for atomic final-approval outbox creation, event
  replay, lease recovery, deterministic PDF hashes, attachment equality,
  attachment-size fallback, provider reconciliation, bounce/rejection, retry
  exhaustion, and automatic final approval.
- Renderer fixtures covering Unicode, RTL, long values, multiline comments,
  split tables, pagination, headers/footers, approved fonts, logos, and
  accessibility metadata.

Low-value snapshots do not replace behavioral assertions.
