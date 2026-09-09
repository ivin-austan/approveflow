# ApproveFlow Product Requirements

## Document status

- Phase: 1 - product and technical design
- Status: awaiting approval
- Product: ApproveFlow, a multi-tenant approval-workflow SaaS for SMEs

## Product objective

ApproveFlow lets organizations replace approvals managed through email and
spreadsheets with configurable request forms, organization-defined approval
journeys, secure assignment, and a complete audit trail.

In these documents, **document** is the user-facing business record and
**request** is the corresponding API/domain aggregate. They refer to the same
approval item unless a narrower technical context is stated.

The request lifecycle and the approval journey are separate concepts. Request
statuses describe the lifecycle at a high level. They do not define the names,
number, order, or assignees of approval stages.

## Users and permissions

The initial user types are:

- Organization owner: controls the organization and delegates administration.
- Organization administrator: manages members, departments, roles, and access.
- Workflow manager: creates, validates, publishes, and archives workflows.
- Requester: creates, submits, tracks, and resubmits requests.
- Approver: acts on approval tasks resolved to their membership.
- Auditor: has read-only access to authorized requests and audit history.

These are product personas, not hard-coded authorization roles. Organizations
define their own role names. Backend permissions, organization membership, and
resource policies determine access.

## Phase 1 functional scope

### Identity and organizations

- Register, sign in, refresh a session, sign out, and revoke sessions.
- Create an organization and switch the active organization.
- Invite members by full name and email address.
- Manage organization departments, department codes, roles, permissions, and
  memberships.
- Associate a membership with one or more departments and organization roles.
- Designate one department as the membership's default when the member belongs
  to more than one department.
- Suspend a membership without deleting its historical attribution.

### Dynamic forms

An authorized workflow manager can build a request form containing ordered
sections and typed fields. Initial field types are:

- Short text
- Long text
- Number
- Money
- Date
- Boolean
- Single select
- Multi-select
- Organization member selector

Fields support type-appropriate validation and validated declarative
conditions. Dynamic form and condition logic must never execute user-provided
JavaScript.

### Document types and numbering

An administrator can define document types independently of internal database
identifiers. Each document type has an organization-unique name and configurable
code. Departments also have administrator-configured codes.

Every formally submitted document receives an immutable, human-readable number
using an allowlisted format such as:

```text
{DEPARTMENT_CODE}/{DOCUMENT_TYPE_CODE}/{YEAR}/{SEQUENCE}
```

Examples:

```text
PLANT/IOC/2026/000123
FIN/FN/2026/000045
LOG/CS/2026/000078
```

Requirements:

- A document is initiated from exactly one department, selected from the
  initiator's active department memberships. A configured default may be
  preselected, but the backend validates the choice.
- Maintain an independent sequence for each organization, originating
  department, document type, and numbering year.
- Interpret `{YEAR}` as the calendar year in the configured business-calendar
  timezone.
- Generate the final number during formal submission, in the same PostgreSQL
  transaction as the submitted audit event.
- Use row locking or an atomic upsert/increment and enforce uniqueness in the
  database so concurrent submissions cannot receive the same number.
- Keep the UUID primary key separate from the business-facing number.
- Never change or reuse an issued number after rejection, cancellation, or
  deletion. An append-only allocation record survives document removal.
- Drafts may display a clearly marked temporary reference, which is not a final
  document number and does not consume a sequence.
- Code or format changes affect future allocations only; issued numbers remain
  unchanged. A code already present in an issued number remains reserved and
  cannot later be assigned to a different department or document type.

### Dynamic approval-stage configuration

For every workflow draft, an authorized organization administrator or workflow
manager can:

- Add any number of stages up to the configured safe limit.
- Give each stage a custom organization-defined name.
- Add an optional description and approver instructions.
- Reorder stages using drag and drop or a keyboard-accessible alternative.
- Duplicate or delete draft stages.
- Add one or more approver assignments to a stage.
- Select an `ANY` or `ALL` completion policy.
- Add a validated activation condition.
- Configure a due duration, reminders, and escalations.
- Preview the complete configured approval journey.
- Save and resume draft editing.
- Validate and publish an immutable workflow version.

The default safe limit is 20 stages per workflow. It is deployment
configuration with a server-enforced platform maximum, not a fixed approval
model. Limits for fields, condition depth, approvers, reminders, and
escalations are also server-controlled and exposed to the builder.

Due durations, reminders, escalation thresholds, and automatic-approval
thresholds use an organization business calendar. The calendar defines its
timezone, working days, working hours, and holidays so deadlines are calculated
in business time rather than simple elapsed time.

Names such as `Project Manager Approval`, `Finance Verification`, and `CEO
Final Approval` are organization-defined labels. No stage name or executive
role has special application behavior.

### Approver assignments

A stage supports one or more assignment rules. Each rule has one of these
types:

1. `MEMBERSHIP`: one specific organization membership.
2. `ROLE`: all eligible active memberships holding an organization role. Role
   assignments always resolve every matching active member; there is no
   round-robin or single-member selection strategy.
3. `DEPARTMENT_ROLE`: all eligible active memberships in a selected department
   and holding a selected role.
4. `REQUESTER_MANAGER`: the active membership referenced as the requester's
   reporting manager.
5. `FORM_FIELD_USER`: the active membership selected in a configured member
   form field. This ships in the initial MVP. The document initiator supplies
   the field while creating the document, and the backend verifies that it
   resolves to an eligible active membership in the same organization.

Each assignment is resolved to specific active memberships when a request is
submitted. Duplicate resolutions are deduplicated by membership. The runtime
approval task uses membership identity; email is display and delivery data
only.

The specific-person selector displays the member's full name, email address,
organization roles, departments, and membership status. Inactive memberships
cannot be selected for a publishable workflow.

### Inviting an approver from the builder

An authorized administrator can start an organization invitation from the
workflow builder by entering:

- Full name
- Email address
- Department
- One or more organization roles

The invitation produces a normal organization invitation and an email through
the notification outbox. A draft can retain a reference to the pending
invitation. It cannot be published while a required specific-person assignment
is unresolved or points to an inactive membership. Approval tasks are never
sent to arbitrary or unverified email addresses.

### Workflow versioning and publication

- A workflow has a stable identity and one or more versions.
- A workflow can have at most one editable draft version.
- A published version is immutable.
- Editing a published workflow creates a new draft version.
- Existing requests remain attached to the version used at submission.
- Archiving prevents new use without changing historical requests.
- Publication is an authorized, transactional operation.

Publication validation must confirm:

- The workflow contains at least one stage unless automatic approval is
  explicitly enabled.
- Every stage has a non-empty name.
- Stage positions are unique and contiguous.
- Every required stage contains at least one structurally valid assignment.
- Referenced memberships are active.
- Referenced memberships, roles, departments, fields, and invitations belong to
  the same organization and workflow version as applicable.
- No pending invitation remains in a required specific-person assignment.
- Every referenced field is valid for the operator and condition.
- Every stage is reachable for at least one valid condition outcome.
- The final applicable stage can be determined at runtime.
- Reminder and escalation settings are valid relative to the due duration.

### Approval-stage execution

Configured stages execute sequentially by `stage.position`. Separate stages do
not execute in parallel in the first MVP.

When a stage becomes active, all resolved approvers for that stage receive
pending tasks and may act in parallel:

- `ANY`: the first approval completes the stage. Remaining pending tasks are
  marked `SKIPPED`.
- `ALL`: every resolved approver must approve before the stage completes.

For both policies, an authorized rejection immediately rejects the request, and
an authorized return immediately returns responsibility to the document
initiator. Remaining tasks in the active and future stages are closed or
skipped. A return does not assign the initiator an approval task or bypass the
self-approval rule. These semantics are centralized in the backend and displayed
in the builder.

Only after the current stage completes does the backend activate the next
applicable stage. A decision must target a currently pending task assigned to
the acting membership. Self-approval is rejected unless the immutable workflow
version explicitly permits it.

Role, department, manager, or membership changes after submission never
silently rewrite runtime tasks. An authorized user may explicitly reassign a
pending task to another eligible active membership. The original task is closed
as reassigned, the replacement is linked to it, the change is audited, and the
new assignee receives the normal approval email.

### Final approver behavior

There is no persisted `isFinal` field in a workflow definition. At submission,
the backend evaluates stage activation conditions, orders applicable stages by
position, and marks the last applicable runtime stage as the final stage.

The builder labels the last currently previewed stage `Final approval stage`.
Because conditions can alter the runtime path, this preview label is an
explanation rather than the authoritative runtime result.

When the final applicable stage satisfies its completion policy, the backend:

1. Completes the runtime stage.
2. Marks the request `APPROVED`.
3. Records the decision and immutable audit event.
4. Creates one pending approved-PDF artifact record.
5. Queues post-commit PDF generation.
6. Queues completion notification processing for the initiator and configured
   recipients after the PDF is ready.

If no stage applies, submission fails unless the document type's published
configuration explicitly allows no-stage automatic approval. That action
creates a distinct system audit event and does not fabricate a human approver
decision.

### Business-time escalation and automatic approval

An organization administrator configures automatic approval for each document
type; it does not require a separate elevated permission beyond document-type
administration. The published workflow version snapshots the policy used by new
documents.

When an active approval stage remains incomplete beyond its configured
business-time threshold, a scheduled backend action completes that stage as a system
automatic approval. It never impersonates a member. The audit timeline displays
`System Auto-Approved`, including the policy, deadline, stage, and system actor.
If another applicable stage remains, it becomes active and receives the same
notification flow as after a human approval. If the automatically completed
stage is final, the document becomes `APPROVED` and the initiator receives the
completion notification.

Review escalations have only two permitted effects in the initial release:

- Notify configured, verified organization recipients.
- Return responsibility to the document initiator for review or correction.

The second action transitions the document to `RETURNED`; it does not turn the
initiator into an approver and cannot reassign an approval task to an arbitrary
person.

### Request lifecycle

High-level request statuses are:

- `DRAFT`
- `SUBMITTED`
- `IN_REVIEW`
- `RETURNED`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

The normal lifecycle is:

```text
DRAFT -> SUBMITTED -> IN_REVIEW -> APPROVED
                              |-> REJECTED
                              |-> RETURNED -> SUBMITTED -> IN_REVIEW
DRAFT ---------------------------------------> CANCELLED
RETURNED ------------------------------------> CANCELLED
```

`SUBMITTED` is a durable append-only audit event rather than a resting current
status. During the same transaction, the backend resolves the runtime path and
sets the document's current status to `IN_REVIEW`, or to `APPROVED` for a
permitted no-stage automatic approval. This preserves complete history without
leaving documents stuck in `SUBMITTED`.

`IN_REVIEW` only means that one configurable approval stage is active. It does
not identify a particular role or level.

The request UI additionally displays:

- Current stage name
- Current level, such as `Level 2 of 4`
- Current resolved approver names and role labels
- Completed and remaining stages
- The final applicable stage
- Approval timeline and decision comments

### Request actions

- Save a draft request.
- Validate answers against the selected published workflow version.
- Submit or resubmit using an idempotency key.
- View own requests and permitted organization requests.
- Approve, reject, or return an assigned pending task.
- Require a comment for rejection and return.
- Preserve all earlier decisions and stage instances as history.

Resubmission always creates a new approval round, reevaluates conditions and
assignments, and restarts the entire applicable journey from its first stage.
All earlier rounds, decisions, comments, and stage instances remain immutable
history.

### Workflow-builder interface

The workflow editor includes an `Approval Stages` builder. Each stage card
shows:

- Level number
- Custom name and description
- Approver assignment types
- Selected names, emails, roles, departments, and membership status
- `ANY` or `ALL` completion policy
- Condition summary and conditional-stage indicator
- Due duration, reminder, and escalation summary
- Whether it is the final stage in the current preview

Actions include:

- Add Approval Level
- Duplicate Stage
- Reorder Stage
- Delete Stage
- Add Approver
- Invite Approver
- Preview Workflow
- Validate Workflow
- Publish Workflow

The preview shows a dynamic path, for example:

```text
Draft -> Submitted -> Supervisor Approval -> Approved
```

or:

```text
Draft -> Submitted -> Project Manager Approval
      -> Finance Manager Approval [conditional]
      -> General Manager Approval
      -> CEO Final Approval
      -> Approved
```

For conditional workflows, preview supports representative form values and
clearly distinguishes included, excluded, and conditional stages.

### Notifications

After every human approval decision, the backend reevaluates the active stage.
Only when its `ANY` or `ALL` policy is satisfied does it identify and activate
the next applicable level. Initial submission, human stage completion, and every
system automatic approval perform activation in the state-change transaction.
When that stage becomes active, one post-commit notification is queued for each
resolved active approver. The email includes:

- Approver name and snapshotted role label
- Document type and immutable reference number
- Submitter's name
- Current approval status and stage name
- Required action
- Due date, when configured
- A secure **Review Document** link

The review link deep-links to that document's approval page. An authenticated
authorized approver is sent directly there. An unauthenticated user signs in
first and is returned only to the validated same-origin document route. Opening
the link never approves a document; the backend rechecks tenant membership,
task assignment, permission, and current task state before displaying or
accepting an action.

The system also queues configured reminders and escalations. When the final
stage completes, it notifies the initiator and configured recipients that the
document received final approval. Automatic approvals use the same next-stage
and final-notification flow and appear as `System Auto-Approved` in history.

### Approved-statement PDF

Final approval starts an idempotent background process that generates one
canonical approved-statement PDF from the immutable approved document and
approval snapshots. The PDF must clearly display an **Approved** marker and
include all relevant permitted information:

- Organization name
- Document type and immutable document number
- Originating department
- Initiator name
- Submission and final-approval timestamps
- Form field labels and submitted values
- Applied workflow version and approval round
- Applicable approval stages in order
- Approver names and snapshotted role/department labels
- Human decisions, system automatic approvals, decision timestamps, and
  relevant comments
- An explicit final approval statement and timestamp
- Artifact ID, approval-snapshot manifest hash, and renderer version. The final
  PDF-byte SHA-256 is stored and displayed alongside the artifact rather than
  embedded into its own bytes, avoiding a self-referential hash.
- Page number and total page count in the footer
- A fixed generation timestamp for traceability

Secrets, tokens, internal security fields, unrelated audit metadata, and fields
excluded by the published document-type artifact policy are omitted. Access is
granted only to users authorized to see the complete canonical artifact. The PDF
is a system-generated artifact, not a user-uploaded attachment.

The canonical PDF is generated by a backend worker after the final-approval
transaction commits. The approved request remains approved if generation or
delivery fails. Generation and email states are visible to authorized users and
operators, failures are retryable, and retries reuse the same logical artifact
and delivery keys.

The canonical PDF represents generated approval records and typed approver
names. These are not handwritten, scanned, qualified electronic, or
cryptographic signatures. A later cryptographic-signature feature requires a
separate legal and technical design.

### PDF rendering requirements

- Bundle and embed approved, version-pinned fonts. The initial family is Noto
  Sans plus the appropriate Noto fonts for supported scripts.
- Support Unicode and right-to-left text with correct shaping and bidirectional
  layout. Verify jsPDF behavior in the backend worker early; an alternative
  renderer requires approval if the acceptance tests cannot be met.
- Paginate long values and multiline comments without clipping. Repeat table
  headers when tables split across pages and keep decision rows readable.
- Repeat a compact organization/document header and page-number footer.
- Use only a validated organization logo from private storage. Accept bounded
  PNG/JPEG input that has been decoded and re-encoded; do not fetch remote images
  or embed SVG/active content during rendering.
- Produce selectable text, document title/language metadata, logical reading
  order, meaningful headings, sufficient contrast, and other PDF accessibility
  features. PDF/UA-1 is the target for canonical artifacts. The implementation
  spike must measure whether compliant tagged-PDF behavior is achievable with
  jsPDF; failure requires an explicit renderer decision rather than silently
  lowering the accessibility requirement.
- Render deterministically from a versioned model, pinned fonts, fixed locale,
  snapshotted timezone, stable ordering, fixed metadata, and the artifact's
  recorded generation timestamp. A retry for the same artifact must produce the
  same bytes and hash.
- Support at most 500 pages and a 20 MiB canonical PDF. Reject larger render
  models safely and record a generation failure rather than exhausting worker
  resources.

### PDF and email state behavior

PDF states are `PENDING`, `GENERATING`, `READY`, `FAILED`, and `DELETED`.
Email states are `PENDING`, `SENDING`, `DELIVERED`, `FAILED`, and
`PERMANENTLY_FAILED`. Allowed transitions, leases, retry exhaustion, and manual
retry rules are defined in the architecture and database documents.

Canonical PDFs are private and retained according to the document type's policy,
default seven years after final approval. Legal hold prevents deletion. When
retention expires, private bytes are deleted, the artifact becomes `DELETED`,
and required metadata and audit history remain according to policy.

The attachment recipient is the initiator's current verified account email,
captured when final approval commits. It is used only when the initiator's
organization membership is active. The submission-time email is not used, and
the PDF is not sent to both addresses. If the membership is suspended/inactive
or the current email is unverified, no provider call occurs and the logical
delivery becomes `PERMANENTLY_FAILED` with a safe eligibility reason.

Immediately before provider submission, the worker rechecks that the membership
is still active and the snapshotted address remains the account's current
verified email. If not, it does not send and marks the delivery
`PERMANENTLY_FAILED`. An authorized reopen after eligibility is restored updates
the same logical record to the then-current verified email and is audited.

Configured completion recipients receive a secure authenticated link, not the
PDF attachment. Their membership, document-read permission, and link access are
rechecked when opened.

Only one logical final-approved-PDF delivery record exists for the final
approval event and initiator. Provider submission is at least once, with a
provider idempotency key where supported. Ambiguous timeouts enter
reconciliation before another send. Bounces, provider rejection, and exhausted
retries are tracked; permanent failures require an authorized, audited manual
reopen after the cause has been corrected.

If the PDF exceeds the configured provider attachment limit (default 10 MiB),
the initiator receives the same final-approval email with a secure authenticated
download link and no attachment. The delivery records `SECURE_LINK` mode and the
reason the attachment was omitted.

Generation, storage, viewing, print intent, downloading, access grants, emailing,
delivery failure, retry/reopen, retention deletion, and recovery create
append-only audit events.

### Document-type dashboards

Every active document type has a separately addressable dashboard implemented
from one reusable, document-type-scoped dashboard feature. It is not a set of
hard-coded pages. Authorized users can view and manage only documents allowed by
their tenant permissions and ownership policies.

Each dashboard provides:

- Document-type name and code
- Real status totals and due/overdue counts
- Paginated documents scoped to that document type
- Filters for number, initiator, originating department, status, current stage,
  and date
- Current approval progress and responsible approvers
- Approved-PDF generation and email-delivery status
- **View PDF**, **Print PDF**, and **Download PDF** actions for approved documents
- Retry controls for authorized operators when generation or delivery failed
- CSV export of the current authorized filter set, up to the configured limit

An approved document appears on its corresponding dashboard immediately after
the approval transaction commits. While its PDF is pending, the dashboard shows
`Generating PDF`; print/download becomes available when the canonical artifact
is ready.

The approved PDF is fetched through an authorized API and used for browser print
and download. jsPDF is the approved PDF library for shared rendering and for
client-side generation where appropriate, such as a clearly labeled preview.
The browser is not trusted to create or replace the canonical artifact emailed
after approval.

Dashboard visibility is the union of explicitly granted scopes:

- `request.read_all`: all authorized documents of the type.
- `request.read_department`: documents originating in any of the viewer's active
  departments.
- `request.read_own`: documents initiated by the viewer.
- `approval.read_assigned`: documents with a task assigned to the viewer.

Filters never expand those scopes. The default view uses the current calendar
year, excludes `CANCELLED`, sorts by `updated_at` descending, and returns 25 rows
per cursor page with a maximum of 100. Allowed sorts are document number,
created, submitted, approved, updated, status, and current stage. Metrics use the
same authorization and filter scope and include total, draft, in-review,
returned, approved, rejected, overdue, PDF pending/failed, and delivery failed.

Users with document visibility and `approved_pdf.read` can access approved
artifacts. The initiator can see the high-level status of their own final email.
Detailed failure codes, attempt history, reconciliation state, and retry/reopen
actions are visible only to users with `approved_pdf.retry`.

Each document type can configure default visible columns from an allowlist of
system columns and explicitly non-sensitive form fields. Users may personalize
their view only within that allowlist. CSV export applies the same row and field
authorization, is audited, and is capped at 10,000 rows; larger exports fail
with guidance rather than silently truncating.

**Print PDF** is disabled until the canonical artifact is `READY`. It opens that
artifact through the browser print dialog and never regenerates it with jsPDF.
Loading, unavailable, failed, and retry states are keyboard accessible and
announced to assistive technology.

The complete final-approval flow is:

```text
Final stage completes
-> Document becomes APPROVED and audit/outbox records commit
-> Canonical approved-statement PDF is generated
-> PDF is stored and generation status becomes READY
-> One logical email with the PDF attachment, or size-limit secure link, is sent
   to the eligible initiator
-> Delivery status is recorded
-> Document-type dashboard supports view, print, and download
```

### Lists, reporting, and audit

- Paginated `My Requests` and `My Approvals` views.
- Filters for workflow, requester, assignee, status, stage, and date.
- Append-only audit history for workflow, request, decision, membership, and
  authorization changes.
- Operational metrics must be derived from real data.

## Non-functional requirements

- Strict TypeScript in all packages.
- Responsive, semantic, keyboard-accessible interfaces.
- Tenant scoping and authorization on every backend operation.
- Transactional, idempotent submission and approval decisions.
- Protection against duplicate and concurrent decisions.
- UTC `timestamptz` persistence and locale-aware display.
- Structured logs with correlation IDs and sensitive-data redaction.
- Typed, idempotent, retryable, observable background jobs.
- Cursor pagination for growing operational lists.
- Real PostgreSQL integration tests for persistence, transactions, and
  concurrency.

## Deferred scope

- Parallel branches across separate stages
- Guest or arbitrary-email approvers
- Native mobile applications
- SAML/SSO and SCIM
- Delegation and out-of-office substitution
- User-uploaded attachments remain deferred until their storage and
  malware-scanning design is approved
- Public forms and external portals
- Custom executable scripts
- Billing integration
- Microservices

## Acceptance outcomes

Phase 1 implementation is successful when an authorized organization user can
define a workflow with arbitrary stage names and order, publish an immutable
valid version, submit a request, resolve dynamic assignments to memberships,
complete each applicable stage sequentially, and reach a correct terminal state
with tenant isolation, idempotency, notifications, and a complete audit trail.
Final approval must also produce one tracked canonical approved-statement PDF,
deliver it once logically to the initiator, and expose it through the correct
permission-scoped document-type dashboard for view, print, and download.
