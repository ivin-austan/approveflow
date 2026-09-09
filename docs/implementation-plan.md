# ApproveFlow Implementation Plan

## Document status

- Phase: 1 - implementation planning
- Status: awaiting approval
- Current gate: do not begin Phase 2 until the Phase 1 correction is approved

## Delivery principles

- Implement one focused vertical slice at a time.
- Keep the approved pnpm/Turborepo modular-monolith architecture.
- Use React 19, Vite, Express, PostgreSQL, Drizzle, Redis, and BullMQ.
- Generate and review migrations; never use schema push in production.
- Treat authorization and tenant isolation as acceptance criteria, not later
  hardening.
- Use real PostgreSQL integration tests for transactions and concurrency.
- Update OpenAPI with every contract change.
- Run formatting, linting, type checking, relevant tests, and affected
  production builds after each implementation phase.

## Phase 2 - monorepo foundation

Deliverables:

- Create the pnpm workspace and Turborepo task graph.
- Scaffold `apps/web`, `apps/api`, and approved reusable packages.
- Enable strict shared TypeScript configuration.
- Establish formatting, linting, Vitest, and build commands.
- Add React 19/Vite, Express, typed configuration, and Pino composition roots.
- Add standard response/error envelopes and correlation IDs.
- Add local PostgreSQL and Redis development configuration.
- Run an early jsPDF backend-worker spike covering deterministic bytes,
  embedded fonts, Unicode/RTL, long pagination, tables, and accessible-PDF
  expectations. Present evidence before approving a different renderer.
- Add CI for install, formatting, linting, type checking, testing, and builds.

Exit criteria:

- A clean checkout has documented setup.
- All empty-foundation checks and production builds pass.
- No business feature or database migration is implemented prematurely.

## Phase 3 - database, identity, and tenant boundary

Deliverables:

- Add Drizzle schema and generated migrations for users, organizations,
  departments, membership-department links, memberships, roles, permissions,
  invitations, and sessions.
- Add test PostgreSQL lifecycle and factories.
- Implement Argon2id authentication and rotating refresh sessions.
- Implement organization onboarding and active-organization resolution.
- Implement multi-department membership, one default department, role,
  reporting-manager, and invitation administration.
- Add deny-by-default policies and repository tenant context.

Exit criteria:

- Authenticated users can access only organizations with an active membership.
- Cross-tenant reads, writes, and references are rejected in integration tests.
- Refresh rotation, revocation, and invitation security tests pass.

## Phase 4 - workflow definitions and Approval Stages builder

### Backend

- Add workflow, version, form, stage, assignment, reminder, and escalation
  schemas and migrations.
- Add document-type and business-calendar schemas, configuration APIs, and
  administration UI.
- Add configurable department/document-type codes and allowlisted numbering
  formats.
- Implement workflow draft creation and optimistic revision handling.
- Implement typed condition AST validation and evaluation.
- Implement assignment discriminated unions for `MEMBERSHIP`, `ROLE`,
  `DEPARTMENT_ROLE`, `REQUESTER_MANAGER`, and initial-MVP `FORM_FIELD_USER`.
- Resolve every matching active member for role and department-role previews.
- Add business-time due, reminder, escalation, and automatic-approval policy
  validation.
- Implement publication-grade validation with entity-addressable errors.
- Implement transactional publication and published-version immutability.
- Implement preview using representative form answers.

### Frontend

- Build workflow list, editor, form builder, and `Approval Stages` builder.
- Add stage cards with level, custom content, assignments, completion policy,
  condition, due/reminder/escalation summary, and final-preview label.
- Add `Add Approval Level`, duplicate, accessible reorder, delete, add approver,
  invite approver, preview, validate, and publish operations.
- Add member selectors displaying name, email, roles, department, and status.
- Allow the document initiator to populate secure member-selector fields used by
  `FORM_FIELD_USER` assignments.
- Keep unsaved builder state separate from persisted definitions.
- Surface server validation next to the affected stage, field, or assignment.

### Required tests

- Arbitrary organization-defined stage names and counts within configured limits.
- Contiguous reorder and stable IDs.
- `ANY` and `ALL` configuration.
- Same-tenant assignment references.
- Pending invitation blocks publication.
- Inactive membership blocks publication for a specific-person assignment.
- Cross-tenant membership/role/department/field references fail.
- Multi-department membership and exactly one originating-department rule.
- Business-calendar and automatic-approval configuration validation.
- Conditional reachability and final-stage preview.
- Published versions reject mutation.
- Keyboard-accessible builder behavior.

Exit criteria:

- An authorized manager can publish a valid immutable workflow with dynamically
  named and ordered stages.
- No hard-coded approval role or fixed level count exists.
- Preview displays the representative configured path.

## Phase 5 - requests and runtime path resolution

Deliverables:

- Add request, answer, approval-round, runtime-stage, task, idempotency, audit,
  outbox, number-sequence, and append-only number-allocation migrations.
- Build dynamic request-form rendering from published configuration.
- Implement draft request persistence and server-side answer validation.
- Implement transactional idempotent submission.
- Validate one originating department from the initiator's active departments.
- Allocate the immutable department/document-type/year number transactionally.
- Append `SUBMITTED` durably and set current status to `IN_REVIEW` in the same
  transaction.
- Evaluate conditional stages and allocate applicable level numbers.
- Resolve every assignment to active same-tenant memberships.
- Deduplicate memberships resolved through multiple rules.
- Snapshot stage details and resolved approver presentation data.
- Derive and mark the final applicable runtime stage.
- Fail when no stage applies unless automatic approval is enabled.
- Activate all tasks in the first stage simultaneously.
- Expose request progress, current stage, assignees, remaining stages, final
  stage, and timeline.

Required integration tests:

- Specific membership, role, department-role, and requester-manager resolution.
- Initial-MVP form-field-user resolution from an initiator-populated field.
- No eligible approver and inactive/suspended member failures.
- No-applicable-stage failure and explicit automatic approval.
- Conditional final-stage derivation.
- Cross-tenant resolution attacks.
- Submission idempotency and key/body mismatch.
- Concurrent numbering, sequence isolation, UUID separation, immutable number,
  code reservation, calendar-year rollover, and non-reuse after rejection,
  cancellation, or deletion.
- Request remains bound to its published version.

Exit criteria:

- Submission creates one immutable sequential runtime path whose tasks all point
  to specific memberships.
- Request UI distinguishes lifecycle status from approval-stage progress.

## Phase 6 - approval engine

Deliverables:

- Implement centralized request, stage, and task transition tables.
- Implement membership-assigned approve, reject, and return commands.
- Implement `ANY`: first approval completes the stage and skips remaining tasks.
- Implement `ALL`: all resolved tasks must approve.
- Activate the next stage only after current-stage completion.
- Complete the request only after the derived final applicable stage completes.
- Enforce comments for reject and return.
- Enforce immutable workflow self-approval policy.
- Implement permission-protected, idempotent, audited reassignment that retains
  the original task and notifies the replacement membership.
- Implement resubmission using the approved restart policy and new approval
  rounds: always reevaluate and restart from the first applicable stage.
- Build assigned inbox and responsive approval-detail/action UI.

Required real-PostgreSQL tests:

- One-stage and multi-stage workflows.
- `ANY` and `ALL` task races.
- Sequential activation and prevention of future-stage decisions.
- Rejection, return, and resubmission.
- Immediate rejection/return and full-journey restart after resubmission.
- Stale task and stale request revision conflicts.
- Duplicate idempotent decisions.
- Self-approval denied and explicitly allowed.
- Runtime role/department edits do not silently reassign tasks; explicit
  reassignment preserves history and tenant isolation.
- Final-stage completion performs exactly one request approval transition.

Exit criteria:

- Concurrent decisions cannot double-advance or corrupt a request.
- All critical transitions produce immutable audit and outbox records.

## Phase 7 - notifications, approved PDFs, dashboards, and escalations

Deliverables:

- Add BullMQ outbox dispatch and typed email jobs.
- Add approved-artifact and delivery-status migrations, repositories, policies,
  and operational retry commands.
- Use the validated jsPDF approach to create a shared typed PDF model and
  renderer for the backend worker and permitted browser previews.
- Generate one canonical PDF after final approval, store it under a
  tenant-scoped deterministic key, and record its hash, size, renderer version,
  attempts, and status.
- Email the ready PDF to the initiator's current verified email captured at final
  approval, only while their organization membership is active. Use one logical
  delivery and a provider idempotency key where supported.
- Send configured recipients an authenticated link only. Use the same link-only
  mode for the initiator when the PDF exceeds the provider limit, default 10 MiB.
- Implement explicit artifact and delivery transition services, leases, jittered
  retry schedules, exhaustion, reconciliation, bounce/rejection handling, and
  permission-protected manual retry/reopen.
- Implement private tenant-scoped artifact storage, five-minute audience/purpose
  access grants, retention/legal hold, encrypted backup/recovery, and PDF-access
  audit events.
- After each human or system stage completion, identify the next level and send
  one stage-activation email per resolved membership.
- Include document type/reference, submitter, current status/stage, required
  action, due date, and secure **Review Document** link.
- Implement sign-in return handling that deep-links authenticated authorized
  users to the document approval page without open redirects or bearer tokens.
- Notify the requester and configured recipients after final approval.
- Add business-calendar due-time scheduling and reminder rules.
- Restrict escalations to verified notifications or
  `RETURN_TO_INITIATOR`, which returns responsibility without assigning the
  initiator an approval task.
- Implement document-type-configured automatic approval for an incomplete stage
  after its business-time threshold, record `System Auto-Approved`, and reuse
  the ordinary next-stage/final notification flow.
- Make jobs retryable, observable, deduplicated, and safe under duplicate
  delivery.
- Build notification state and operational failure visibility.
- Build one reusable document-type dashboard route scoped by organization and
  document type, with real metrics, filters, approval progress, PDF/delivery
  states, and permission-aware management actions.
- Implement all-document, department, own-document, and assigned-document row
  scopes; safe configurable columns; cursor pagination; allowlisted sorting; and
  audited CSV export capped at 10,000 rows.
- Add **View PDF**, **Print PDF**, and **Download PDF** using the authorized
  canonical artifact; allow jsPDF client rendering only for clearly labeled
  noncanonical previews.
- Keep print disabled until `READY`; open the canonical bytes in the browser
  print dialog and audit print intent without invoking jsPDF again.

Required tests:

- No email or provider call inside a database transaction.
- Activation and completion outbox rows commit with state changes.
- Rollback produces no deliverable event.
- Duplicate worker execution does not duplicate logical delivery.
- Links contain no access, refresh, or approval bearer token.
- Signed-out deep links return only to allowlisted same-origin approval routes.
- Business-calendar holiday, timezone, and work-period boundaries are correct.
- Automatic approval is idempotent under duplicate or concurrent jobs and is
  visibly attributed to the system.
- Escalation return immediately closes the round and returns the document to the
  initiator.
- Final approval creates exactly one logical artifact-generation request.
- Final approval, audit, artifact row, recipient delivery snapshots, and
  generation outbox event are atomic; rollback leaves none partially committed.
- Artifact and delivery services reject invalid state transitions and enforce
  attempt limits, jittered schedules, lease ownership, and manual-retry
  permission.
- Generation or storage failure leaves the document approved and retries the
  same artifact safely.
- Delivery failure retries the same delivery without regenerating the PDF or
  creating another logical email.
- Unknown provider timeouts reconcile before resubmission; hard bounce,
  rejection, and retry exhaustion become `PERMANENTLY_FAILED`.
- The approved PDF visibly states approval and contains the authorized document,
  workflow, stage, approver, decision, and timestamp details.
- Approved documents appear immediately on the correct document-type dashboard;
  PDF actions enable only when the artifact is ready.
- Dashboard and artifact endpoints pass tenant, document-type, ownership, and
  permission-isolation tests.
- Suspended, inactive, or unverified initiators receive no provider submission
  and produce `PERMANENTLY_FAILED`; an authorized operator can reopen the same
  record after eligibility is restored.
- Changed-email tests prove that only the current verified email captured at
  final approval is used, and that later suspension/unverification/change blocks
  provider submission until an authorized reopen; configured recipients receive
  secure links only.
- Replayed final-approval events do not create another artifact.
- Expired generation/send leases recover safely; renderer crashes do not leave
  permanent `GENERATING` records.
- Stored SHA-256 matches bytes viewed, printed, downloaded, attached, and
  restored; attachment bytes match the canonical object.
- Large PDFs select link-only delivery and record `SIZE_LIMIT`.
- Unicode, RTL, long text, multiline comments, split tables, page breaks,
  headers/footers, and approved fonts render correctly.
- Short-lived access grants expire and cannot cross audience, purpose, document,
  or tenant boundaries; unauthorized callers cannot infer artifact existence.
- Email addresses, document content, storage keys, and access URLs/tokens are
  redacted from logs.
- Dashboard counts remain correct during concurrent approval, PDF, and delivery
  processing.
- Human and automatic final approval use the same pipeline, while a later
  approved resubmission round creates a new artifact without overwriting the old.

Exit criteria:

- Stage activation, reminders, escalations, canonical PDF generation, and
  completion delivery operate from durable committed records.

## Phase 8 - audit, UX completion, and release hardening

Deliverables:

- Complete permission-aware audit and approval timelines.
- Complete loading, empty, error, permission-denied, and success states.
- Add Playwright journeys for onboarding, invitation, publication, submission,
  dynamic multi-level approval, return, resubmission, final PDF delivery, and
  document-type dashboard print/download.
- Apply CSP, CORS, rate limits, body/complexity limits, and log redaction.
- Validate accessibility across desktop, tablet, and mobile.
- Establish monitoring, backup/restore, migration, and incident procedures.
- Add metrics and alerts for PDF generation latency/failure, email queue age and
  delivery failures, retry exhaustion, stuck outbox/leases, artifact/hash
  inconsistencies, and dashboard query performance.
- Establish performance baselines for inbox, request lists, submission, and
  concurrent decisions.
- Perform a focused security and tenant-isolation review.

Exit criteria:

- All required checks and production builds pass.
- Release-readiness evidence exists for correctness, accessibility, operations,
  backup recovery, and security.
- Deployment and production migrations occur only after separate approval.

## Explicitly deferred capabilities

- Parallel branches between separate stages.
- Arbitrary scriptable workflow logic.
- External or guest approvers.
- User-uploaded file attachments until storage and malware controls are approved.
- SSO/SAML and SCIM.
- Delegation and out-of-office substitution.
- Public forms.
- Native mobile applications.
- Microservices.

## Confirmed product decisions

1. Resubmission creates a new round and restarts the entire evaluated journey
   from the first applicable stage.
2. Role and department-role assignments resolve every matching active member;
   no round-robin strategy is used.
3. Memberships can belong to multiple departments, while each document is
   initiated from exactly one validated department.
4. Rejection and return are immediately decisive.
5. Escalations may notify verified recipients or return responsibility to the
   initiator; returning does not create an initiator approval task.
6. Due dates, reminders, escalations, and automatic approvals use business
   calendars.
7. Post-submission assignee changes require an explicit authorized and audited
   reassignment operation; role or department edits never silently rewrite
   runtime tasks.
8. `FORM_FIELD_USER` ships in the initial MVP and is supplied through a secure
   member-selector field by the document initiator.
9. Document-type administrators configure automatic approval without a separate
   elevated permission. An incomplete stage that exceeds its snapshotted
   business-time threshold is recorded as `System Auto-Approved` and follows the
   normal next-stage notification flow.
10. `SUBMITTED` is a durable audit event, while the current document status is
    set to `IN_REVIEW` in the same transaction.
11. Every submitted document receives an immutable business number with a
    sequence scoped by organization, originating department, document type, and
    year. UUID primary keys remain separate and issued numbers are never reused.
12. Approval emails deep-link through authentication to the authorized document
    approval page and are sent whenever the next level becomes active.
13. Final approval queues one canonical approved-statement PDF. Once ready, it
    is emailed once logically to the initiator's current verified email captured
    at final approval, only if their membership is active, and is available for
    authorized dashboard view, print, and download. Configured recipients get a
    secure link only.
14. Document-type dashboards use one reusable implementation scoped by document
    type rather than hard-coded pages.
15. jsPDF is the approved renderer for shared PDF generation and appropriate
    client-side preview use; the backend-generated artifact is canonical.
16. PDF-generation and email-delivery failures have separate tracked states and
    idempotent retries and never reverse document approval.
17. PDF transitions, five-attempt retry policy, lease recovery, and retention
    deletion are explicit. Delivery uses at most eight automatic attempts,
    reconciliation for unknown acceptance, and permanent-failure handling.
18. PDFs over the configured attachment limit use secure-link delivery and
    record that no attachment was included.
19. Canonical PDFs contain typed/generated approval evidence, not handwritten or
    cryptographic signatures.
20. PDF access is private, short-lived, tenant-scoped, retained for seven years
    by default subject to legal hold, and audited for view, print intent,
    download, retry, generation, deletion, and email.

## Remaining Phase 1 decisions

No blocking Phase 1 product decision remains. The implementation will treat
`YEAR` as the calendar year in the configured business-calendar timezone,
automatic approval as applying when the active stage remains incomplete at its
deadline, deletion as retaining the append-only number-allocation tombstone, and
the email provider as requiring idempotency support for the strongest one-send
guarantee. The concrete object-storage and email-provider adapters can be chosen
during implementation without changing the domain contract. Any change to these
recorded defaults requires a Phase 1 design amendment.

## Approval gate

Phase 2 must not begin until the corrected Phase 1 documents and recorded
decisions above are reviewed and approved. No dependency installation,
application scaffolding, production infrastructure, or database migration is
authorized by this plan.
