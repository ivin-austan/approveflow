# ApproveFlow Security Model

## Document status

- Phase: 1 - security design
- Status: awaiting approval

## Security objectives

ApproveFlow must preserve:

- Tenant isolation between organizations.
- Confidentiality of identity, request, approval, and attachment data.
- Integrity of published workflows, runtime decisions, and audit history.
- Availability under bounded misuse and job retries.
- Accountability through actor-attributed append-only events.

Authorization failures, cross-tenant references, and tenant data leakage are
critical defects.

## Trust boundaries and untrusted input

Untrusted data includes:

- HTTP params, queries, bodies, headers, and cookies.
- Organization, membership, role, department, workflow, field, and task IDs.
- Workflow definitions, conditions, reminders, and escalation rules.
- Form answers and selected user values.
- Invitation details and tokens.
- Background-job payloads and provider callbacks.
- Text rendered into application pages or email.

Every external boundary validates with Zod, rejects unknown properties where
appropriate, normalizes deliberately, and maps only allowed values into domain
commands. Request bodies are never passed directly to Drizzle inserts/updates.

## Authentication and sessions

- Hash passwords with Argon2id using reviewed parameters.
- Store only password hashes and hashed refresh/invitation/reset tokens.
- Return generic authentication failures to reduce account enumeration.
- Use short-lived access tokens.
- Rotate refresh tokens on every use and detect refresh-token-family reuse.
- Revoke sessions on sign-out, password reset/change, or security action.
- Use Secure, HTTP-only, SameSite cookies for browser refresh tokens.
- Protect cookie-authenticated state changes from CSRF.
- Rate-limit registration, login, refresh, recovery, and invitations by safe
  account/network dimensions.
- Never log passwords, bearer tokens, refresh tokens, or invitation secrets.

Password recovery and email verification are required before public release,
even if delivered after the first internal vertical slice.

## Trusted tenant context

The organization in a URL is not trusted directly. For every protected tenant
request, the backend:

1. Authenticates the user and session.
2. Looks up an active membership matching the requested organization.
3. Creates trusted context from that membership.
4. Loads permissions from active organization-owned role grants.
5. Passes context to authorization policies and repositories.

Tenant-owned repository operations always include `organization_id`. Unscoped
lookup helpers are not exposed to controllers. Composite foreign keys and
unique constraints reinforce same-tenant relationships for memberships, roles,
departments, workflow definitions, runtime stages, and tasks.

Every new tenant-owned feature includes tests that use valid identifiers from a
second tenant and prove read/write isolation. Errors must not reveal that an
inaccessible cross-tenant record exists.

PostgreSQL row-level security is deferred for the first implementation. The
initial defense is mandatory repository scoping, composite integrity
constraints, policy enforcement, and real-database isolation tests. RLS can be
evaluated later as defense in depth without treating it as a substitute for
application authorization.

## Authorization model

- Deny access by default.
- Verify organization membership before permissions.
- Grant granular permission keys through organization-defined roles.
- Never authorize by comparing names such as `CEO`, `Finance Manager`, or
  `Administrator`.
- Enforce ownership and task-assignment policies in backend services/policies.
- Treat UI visibility as convenience only.
- Require both workflow-edit and membership-management authority to invite a
  person from the builder.
- Prevent requesters from approving their own requests unless the immutable
  workflow version explicitly permits it.
- Suspended memberships cannot authenticate into the tenant or receive newly
  resolved approval tasks.
- Document-type administrators may configure automatic approval without a
  separate elevated permission. Publication and runtime validation still apply,
  and every resulting system action is audited.

Suggested initial permissions include:

```text
organization.read
organization.manage
department.read
department.manage
document_type.read
document_type.manage
business_calendar.read
business_calendar.manage
membership.read
membership.manage
role.read
role.manage
workflow.read
workflow.create
workflow.edit
workflow.publish
workflow.archive
request.create
request.read_own
request.read_department
request.read_all
request.cancel_own
request.export
approval.read_assigned
approval.decide
approval.reassign
approved_pdf.read
approved_pdf.retry
audit.read
```

## Dynamic workflow security

### Safe workflow definitions

- Never execute user-provided JavaScript, templates, SQL, or expressions.
- Represent conditions as a typed, allowlisted AST.
- Restrict operators by field type.
- Enforce maximum stage count, assignment count, condition depth/node count,
  field count, option count, and definition payload size.
- Reject cyclic or unreachable dependencies and cross-version field references.
- Escape organization-authored labels and descriptions when rendered.
- Do not allow labels to influence authorization or code paths.

### Publication controls

Publication is permission-protected and revalidates inside a transaction. It
checks contiguous ordering, assignment shapes, active memberships, organization
ownership of every role/department/reference, condition validity, reachability,
and automatic-approval behavior.

Pending invitations can appear only in a draft. Publication blocks until each
required specific-person assignment points to an active membership. The system
never sends an approval request to an arbitrary unverified email address.

Published versions cannot be modified through normal repositories. Existing
requests remain bound to their original version.

### Approver resolution

Every applicable assignment resolves on the backend at submission:

- Membership references must be active and same-tenant.
- Role matches resolve every active membership holding the organization-owned
  role.
- Department-role matches resolve every active membership sharing the selected
  department and role. Memberships may belong to multiple departments.
- Requester-manager matches follow a same-tenant active membership reference.
- Form-field users ship in the initial MVP, must come from a validated
  member-selector field populated by the document initiator, and must resolve to
  an active membership in the same organization.

Resolved memberships are deduplicated. A required applicable stage with zero
eligible approvers aborts submission. Email is delivery/display data, not
identity.

## Runtime integrity and concurrency

- Submission, resubmission, and decisions require idempotency keys.
- Bind idempotency records to organization, actor, operation, canonical request
  hash, and stored response.
- Lock request, round, stage, and task rows in a stable order or use conditional
  atomic updates.
- Accept decisions only for pending tasks in the current round and active stage.
- Use unique constraints to prevent duplicate membership tasks and decisions.
- A concurrent `ANY` completion can advance the stage only once.
- An `ALL` completion is calculated from locked authoritative task state.
- Reject stale revisions and superseded decisions with typed conflicts.
- Derive final-stage identity from the immutable runtime path; do not trust a
  client flag.

When a final applicable stage completes, the decision, stage completion,
request approval, audit event, and outbox entries occur in one transaction.

Resubmission starts a new round from the first applicable stage and never
changes prior round history. A valid rejection or return is immediately
decisive. Return restores responsibility to the initiator without giving that
person an approval task.

Scheduled automatic approval verifies the snapshotted business-calendar
deadline and locks current state before acting. It uses a system actor, never a
membership identity, records `System Auto-Approved`, and follows the same
transactional next-stage/final notification path as a human stage completion.

Escalations are restricted to verified notifications or
`RETURN_TO_INITIATOR`; they cannot silently assign an arbitrary approver.

Post-submission role, department, manager, or membership changes never silently
rewrite runtime assignments. Reassignment requires `approval.reassign`, a
verified active same-tenant replacement membership, an explicit reason,
idempotency, and an immutable audit event. The original task and its snapshots
are retained.

## Invitations

- Generate high-entropy, single-use invitation secrets.
- Store only hashes of secrets.
- Apply expiry, acceptance, revocation, and resend limits.
- Avoid revealing whether an unrelated email is already registered.
- Validate that selected department and roles belong to the inviting
  organization.
- Acceptance creates or activates the membership transactionally.
- Linking a pending draft assignment to the new membership is an authorized,
  audited workflow operation.

## Department selection and document numbering

- A membership may belong to several departments, but each document records one
  originating department.
- Submission verifies that department against the initiator's active
  same-tenant membership-department records.
- Department and document-type codes use a restricted normalized character set
  and cannot inject arbitrary format content.
- Number formats use only allowlisted components; user-authored executable
  templates are prohibited.
- Sequence allocation is scoped by organization, originating department,
  document type, and year and occurs in the submission transaction under a row
  lock or equivalent atomic upsert.
- Unique constraints protect the rendered number and scoped sequence value.
- UUID primary keys remain internal identities; authorization never relies on a
  guessable human-readable document number.
- Append-only allocation records prevent reuse after rejection, cancellation,
  deletion, or code/format changes.
- A department or document-type code used in an allocated number remains
  reserved to that entity and cannot be recycled into another numbering scope.
- Draft temporary references are visibly distinct and never treated as issued
  numbers.

## Notifications and review links

- Write outbox records inside the state-changing transaction.
- Send email only after commit through an idempotent worker.
- Send stage-activation email only to resolved membership addresses.
- Review links route directly to the authenticated document approval page and
  contain no bearer credentials or reusable approval token.
- Unauthenticated recipients sign in first and return through an allowlisted,
  same-origin relative route. Absolute/external return URLs are rejected to
  prevent open redirects.
- Re-check authentication, tenant membership, task assignment, and task state
  when the link is opened or acted upon.
- Keep job payloads minimal and versioned.
- Do not copy form answers into the email body. The canonical attachment includes
  only fields allowed by the approved artifact policy.
- Deduplicate reminder, escalation, and completion notifications.
- Human and system stage completion use the same next-stage notification
  pipeline. Automatic actions are visibly attributed to the system in history.

## Approved PDF and dashboard security

- Final approval creates an artifact request inside the transaction, but PDF
  rendering, object storage, and email occur only after commit.
- The canonical PDF is generated by a backend worker from immutable approved
  request, workflow, runtime-stage, task, and decision snapshots.
- jsPDF receives a bounded typed document model. Organization-authored text is
  treated as text, never executable HTML, JavaScript, URLs, or PDF instructions.
- PDF content excludes secrets, tokens, internal authorization fields,
  unrelated audit metadata, and values outside the published document-type
  artifact policy. Users receive access only if authorized for the complete
  canonical artifact; it is not filtered differently per viewer.
- Generated files have a fixed PDF MIME type, bounded page/byte limits, a
  SHA-256 integrity hash, and a versioned renderer identifier.
- Object keys are unpredictable or deterministic from non-public IDs, scoped by
  organization, encrypted at rest, and never exposed as permanent public URLs.
- PDF view, print, and download always recheck authenticated membership,
  organization scope, document visibility, and `approved_pdf.read`.
- A document number is not an authorization credential.
- Separate document-type dashboards enforce the path document type in every
  query and test cross-type as well as cross-tenant access.
- Browser jsPDF output is allowed for labeled previews where appropriate but
  cannot replace, upload over, or claim to be the canonical approved artifact.
- Canonical rendering embeds version-pinned Noto fonts, supports Unicode and RTL
  shaping, paginates long content, repeats split-table headers, and applies
  stable headers, footers, page numbering, locale, timezone, metadata, ordering,
  and generation time. Retries must reproduce the same bytes and hash.
- Canonical output is capped at 500 pages and 20 MiB. Organization logos must be
  private, size-bounded PNG/JPEG assets decoded and re-encoded before use; no
  remote image, SVG, active content, or user attachment is rendered.
- PDFs provide selectable text, language/title metadata, logical reading order,
  sufficient contrast, and supported tagged-PDF features. jsPDF backend,
  Unicode/RTL, accessibility, and deterministic output are verified early.

The final email is addressed only to the initiator's current verified account
email captured at final approval, and only while their organization membership
is active. The submission-time email is not also used. Suspended, inactive, or
unverified initiators cause `PERMANENTLY_FAILED` without a provider call.
Configured recipients receive an authenticated link only.
They must be active memberships with current verified account emails, and link
access rechecks their document permission.

Immediately before sending, the worker rechecks membership activity and that the
snapshotted email remains current and verified. A subsequent suspension,
unverification, or email change prevents the provider call. Authorized reopen
updates the same logical record only after eligibility is restored.

The initiator delivery uses a unique logical key. The worker must prefer a
provider supporting idempotency, record acknowledgement, and update the same
delivery record on retry. Provider submission is at least once. Unknown
acceptance is reconciled before resubmission; hard bounces, definitive rejection,
and exhausted retries become `PERMANENTLY_FAILED`. The worker never logs attached
bytes or sensitive PDF content.

If the PDF exceeds the configured provider attachment limit, default 10 MiB,
the initiator receives a secure authenticated link with no attachment. The
delivery mode and `SIZE_LIMIT` omission reason are recorded.

Generation and delivery failures do not alter `APPROVED`. Only authorized
operators with `approved_pdf.retry` can trigger a manual retry, and that action
is rate-limited and audited. Retry reuses the existing artifact/delivery record.
Safe error codes, attempt counts, leases, retry times, and terminal failure are
observable without exposing provider secrets.

Artifact access is private and tenant-scoped. The API streams bytes or creates a
five-minute audience- and purpose-bound access grant only after authorization;
there are no public object URLs. Grants expire, are use-bounded, and can be
revoked. The system audits artifact generation, viewing, print intent,
downloading, emailing, retries, access grants, retention deletion, and recovery.

PDFs inherit a document-type retention policy, default seven years after final
approval. Legal holds prevent deletion. Retention removes private bytes, marks
the artifact `DELETED`, and preserves required metadata/audit history. Encrypted
backups follow the retention period plus a documented purge window, and recovery
verifies tenant scope and SHA-256 integrity before serving restored bytes.

Dashboard authorization is the union of all-document, active-department,
initiated-by-user, and assigned-to-user scopes. Filters, metrics, configurable
columns, sorting, and CSV export never widen that union. Delivery failure details
and retry controls require `approved_pdf.retry`; ordinary PDF access also
requires `approved_pdf.read` and access to the underlying document.

## Data protection

- Require TLS for client, database, Redis, and provider connections in
  production.
- Use managed encryption at rest for production persistence and backups.
- Validate configuration and source secrets from an external secret manager or
  environment, never committed files.
- Apply least-privilege credentials separately to API, migration, and worker
  processes where operationally practical.
- Define retention and deletion policies before production onboarding.
- Preserve audit records according to the approved retention policy.
- Treat request answers, comments, approver snapshots, and audit metadata as
  potentially sensitive.
- Validate business-calendar timezones, work periods, holidays, and duration
  bounds. Persist calculated UTC deadlines with the calendar/version snapshot so
  later calendar edits cannot retroactively trigger or suppress an action.

User-uploaded attachments remain deferred until storage isolation, file
size/type controls, malware scanning, signed access, retention, and deletion are
designed. System-generated approved PDFs are in scope under the controls above.

## Web and HTTP defenses

- Restrict CORS to configured trusted origins.
- Apply Content Security Policy and secure HTTP headers.
- Render semantic text safely; do not use unsanitized raw HTML.
- Protect refresh-cookie operations against CSRF.
- Bound JSON body size, pagination, search input, and export volume.
- Validate redirect targets and never accept arbitrary post-login redirect URLs.
- Apply visible focus and keyboard accessibility without weakening permission
  checks.

## Logging, audit, and privacy

Pino redaction covers:

- Authorization and cookie headers
- Password and token fields
- Invitation/reset secrets
- Sensitive form answers and attachment content
- Provider credentials
- Recipient email addresses, generated document content, PDF bytes, storage
  keys, and signed/access-grant URLs or tokens

Operational logs include safe correlation, organization, membership, request,
stage, task, and job IDs where needed. They do not replace audit events.

Append-only audit events capture actor, organization, action, entity, timestamp,
correlation ID, and allowlisted metadata. Normal application code cannot update
or delete audit events. Snapshot emails and role/department labels are exposed
only to authorized viewers and follow retention requirements.

## Abuse and availability controls

- Rate-limit authentication, invitations, publication, submission, decisions,
  and expensive searches.
- Enforce workflow complexity and payload limits server-side.
- Use cursor pagination for growing lists.
- Make queue jobs retryable with bounded exponential backoff and dead-letter
  visibility.
- Use deduplication keys for activation, reminder, escalation, and completion
  jobs.
- Monitor repeated decision conflicts, cross-tenant attempts, invite abuse,
  queue failures, stage ageing, PDF generation latency/failure, email queue age,
  delivery failure, retry exhaustion, stuck outbox/leases, hash mismatches, and
  dashboard query latency.
- Alert on environment-defined thresholds for exhausted retries, unrecovered
  leases, old outbox records, ambiguous provider submissions, repeated hash
  mismatches, and sustained dashboard latency/error rates.

## Security verification

Required automated coverage includes:

- Cross-tenant reads and writes for every tenant-owned resource.
- Cross-tenant role, department, membership, field, invitation, and task
  references.
- Multi-department origin selection and cross-tenant department rejection.
- Concurrent document-number allocation, immutability, and non-reuse after all
  terminal states and permitted deletion.
- Deny-by-default permissions and ownership policies.
- Suspended and pending membership behavior.
- Self-approval restrictions.
- Published-version immutability.
- Malformed, deep, oversized, or invalid conditions.
- Unresolved assignment and empty resolution failures.
- Idempotency reuse with equal and different request bodies.
- Concurrent `ANY` and `ALL` decisions.
- Full-round resubmission after return.
- Business-calendar boundary, timezone, holiday, reminder, escalation, and
  automatic-approval calculations.
- Idempotent `System Auto-Approved` processing and next-level notification.
- Safe sign-in return paths for **Review Document** deep links.
- Exactly one logical approved-PDF artifact and initiator delivery under
  concurrent final-approval and worker retries.
- Atomic final approval, artifact row, audit event, and generation outbox commit;
  replayed final-approval events create no second artifact.
- PDF generation/storage failure, email failure, lease expiry, retry, and
  recovery without changing approval status.
- Renderer crashes cannot leave artifacts permanently in `GENERATING`.
- Cross-tenant and cross-document-type dashboard, PDF metadata, content, and
  retry access.
- Unauthorized callers cannot infer artifact existence through identifiers,
  errors, response shape, or materially distinct timing.
- Malicious labels/answers rendered as inert PDF text and excluded-field
  enforcement.
- Unicode, RTL, long text, multiline comments, tables, headers/footers, and page
  breaks render correctly.
- Stored hash matches the exact bytes served for view, print, download, and
  email; attachment bytes match the canonical stored artifact.
- Oversized PDFs use `SECURE_LINK` with no attachment and record `SIZE_LIMIT`.
- Access grants expire and cannot be reused by another audience or purpose.
- Email addresses, document content, storage data, and signed/access URLs are
  absent from logs.
- Dashboard counts remain correct during concurrent approval, generation, and
  delivery transitions.
- Human and system automatic final approval trigger the same artifact/delivery
  pipeline.
- A later approved resubmission round creates a new artifact without overwriting
  any prior round's artifact.
- PDF content hash and delivery audit correlation.
- Refresh-token rotation and reuse detection.
- Log and error redaction.

A focused threat-model review is required before public release and whenever
attachments, external approvers, SSO, or public forms are introduced.
