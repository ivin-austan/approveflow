# ApproveFlow API Design

## Document status

- Phase: 1 - REST API design
- Status: awaiting approval
- Base path: `/api/v1`

## Principles

- Validate params, queries, headers, and bodies with strict Zod schemas.
- Maintain separate request, response, domain, and persistence models.
- Resolve tenant context from authenticated active membership.
- Enforce authorization on the backend and deny by default.
- Use idempotency keys for submission, resubmission, and decisions.
- Paginate collections and bound all page sizes and filters.
- Update OpenAPI whenever a public contract changes.
- Never return raw database rows, stack traces, or internal security fields.

## Response envelopes

Single-resource success:

```json
{
  "data": {},
  "meta": {
    "requestId": "6ccad9e5-a632-4adf-82f8-e9315a66786a"
  }
}
```

Collection success:

```json
{
  "data": [],
  "meta": {
    "requestId": "6ccad9e5-a632-4adf-82f8-e9315a66786a",
    "page": {
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

Error:

```json
{
  "error": {
    "code": "WORKFLOW_INVALID",
    "message": "The workflow must be corrected before publication.",
    "fields": {
      "stages.1.approvers": ["At least one active approver is required."]
    },
    "requestId": "6ccad9e5-a632-4adf-82f8-e9315a66786a"
  }
}
```

Errors use stable codes and appropriate HTTP statuses. Inaccessible tenant
resources use responses that do not confirm cross-tenant existence.

## Tenant route convention

Tenant endpoints use `/organizations/:organizationId`. The value selects a
candidate organization but is not trusted. Middleware verifies an active
membership and constructs trusted context:

```ts
type TenantContext = {
  userId: string;
  organizationId: string;
  membershipId: string;
  permissions: ReadonlySet<Permission>;
  requestId: string;
};
```

Application services and repositories accept this trusted context. They do not
accept an arbitrary client organization ID as authorization.

## Authentication endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Register and establish a session |
| `POST` | `/auth/login` | Authenticate with generic failure responses |
| `POST` | `/auth/refresh` | Rotate the browser refresh token |
| `POST` | `/auth/logout` | Revoke the current session |
| `POST` | `/auth/logout-all` | Revoke all user sessions |
| `GET` | `/auth/me` | Return safe identity and accessible organizations |

## Organizations, departments, and access

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `POST` | `/organizations` | List accessible or create an organization |
| `GET`, `PATCH` | `/organizations/:organizationId` | Read or update settings |
| `GET`, `POST` | `/organizations/:organizationId/departments` | List or create departments |
| `PATCH`, `DELETE` | `/organizations/:organizationId/departments/:departmentId` | Update or archive a department |
| `GET`, `POST` | `/organizations/:organizationId/business-calendars` | List or create business calendars |
| `GET`, `PATCH` | `/organizations/:organizationId/business-calendars/:calendarId` | Read or update working periods and holidays |
| `GET`, `POST` | `/organizations/:organizationId/document-types` | List or create document types |
| `GET`, `PATCH` | `/organizations/:organizationId/document-types/:documentTypeId` | Configure code, numbering, calendar, and automatic approval |
| `GET` | `/organizations/:organizationId/document-types/:documentTypeId/dashboard` | Return scoped dashboard metrics and documents |
| `GET`, `POST` | `/organizations/:organizationId/roles` | List or create organization roles |
| `PATCH`, `DELETE` | `/organizations/:organizationId/roles/:roleId` | Update or archive a role |
| `GET`, `POST` | `/organizations/:organizationId/memberships` | List members or create an authorized membership operation |
| `GET`, `PATCH` | `/organizations/:organizationId/memberships/:membershipId` | Read or update membership, department, manager, or status |
| `GET`, `POST` | `/organizations/:organizationId/invitations` | List or issue invitations |
| `POST` | `/invitations/:token/accept` | Accept an invitation through its secret |

Member-selector responses expose full name, email, current organization roles,
departments, and membership status only to authorized callers. Search is
paginated, normalized, and bounded.

Department and document-type write contracts accept normalized codes used only
through allowlisted numbering components. A document type can configure a
business calendar, sequence padding, numbering pattern, and business-time
automatic-approval threshold. Normal document-type administration permission is
sufficient; there is no separate automatic-approval permission.

```json
{
  "code": "FN",
  "numberFormat": "{DEPARTMENT_CODE}/{DOCUMENT_TYPE_CODE}/{YEAR}/{SEQUENCE}",
  "sequencePadding": 6,
  "businessCalendarId": "uuid",
  "approvedPdfRetentionYears": 7,
  "approvedPdfFieldPolicy": {
    "includeAllSubmittedFields": true,
    "excludedFieldIds": []
  },
  "automaticApproval": {
    "enabled": true,
    "after": { "value": 3, "unit": "BUSINESS_DAYS" }
  }
}
```

The scheduled automatic-approval command is internal, idempotent, and not a
public user endpoint. It acts only when the current stage is still incomplete
after the snapshotted deadline.

## Workflow endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `POST` | `/organizations/:organizationId/workflows` | List or create workflows |
| `GET`, `PATCH` | `/organizations/:organizationId/workflows/:workflowId` | Read or update workflow metadata |
| `POST` | `/organizations/:organizationId/workflows/:workflowId/draft` | Create a draft from the current published version |
| `GET`, `PUT` | `/organizations/:organizationId/workflows/:workflowId/versions/:versionId` | Read or atomically replace an editable draft definition |
| `POST` | `/organizations/:organizationId/workflows/:workflowId/versions/:versionId/validate` | Run publication-grade validation |
| `POST` | `/organizations/:organizationId/workflows/:workflowId/versions/:versionId/preview` | Evaluate a representative path |
| `POST` | `/organizations/:organizationId/workflows/:workflowId/versions/:versionId/publish` | Publish an immutable version |
| `POST` | `/organizations/:organizationId/workflows/:workflowId/archive` | Prevent future use |

The initial builder save uses an atomic full-definition `PUT` with an expected
revision. This avoids partially persisted reorder operations and enables a
single validation boundary. Payload size and definition complexity are bounded.

### Draft stage contract

A stage definition resembles:

```json
{
  "id": "uuid",
  "name": "Finance Verification",
  "description": "Verify budget availability.",
  "instructions": "Check the cost center and supporting documents.",
  "position": 2,
  "completionPolicy": "ALL",
  "dueDuration": {
    "value": 2,
    "unit": "BUSINESS_DAYS"
  },
  "activationCondition": {
    "kind": "comparison",
    "fieldId": "uuid",
    "operator": "gte",
    "value": 5000
  },
  "approvers": [
    {
      "id": "uuid",
      "assignmentType": "DEPARTMENT_ROLE",
      "departmentId": "uuid",
      "roleId": "uuid",
      "displayOrder": 1
    }
  ],
  "reminders": [],
  "escalations": []
}
```

Durations use positive integer business hours or business days. The backend
uses the published document type's business calendar and stores the calculated
UTC deadline. The calendar timezone, work periods, and holidays are validated
separately.

### Assignment contract validation

Approver assignments are a discriminated union:

- `MEMBERSHIP`: requires `membershipId`, or `invitationId` in an editable draft.
- `ROLE`: requires `roleId`.
- `DEPARTMENT_ROLE`: requires `departmentId` and `roleId`.
- `REQUESTER_MANAGER`: accepts no reference ID.
- `FORM_FIELD_USER`: requires a compatible `formFieldId`; it ships in the
  initial MVP and is populated by the document initiator.

Unexpected reference fields are rejected. The server verifies every reference
against the trusted organization and relevant workflow version.

### Builder support endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/organizations/:organizationId/approver-options/memberships` | Search active/pending members for selection display |
| `GET` | `/organizations/:organizationId/approver-options/roles` | List organization-defined roles |
| `GET` | `/organizations/:organizationId/approver-options/departments` | List organization departments |
| `POST` | `/organizations/:organizationId/workflow-approver-invitations` | Invite a person from the builder |

The invitation endpoint requires membership-management permission in addition
to workflow-edit permission. It returns a safe invitation reference; it does
not create a usable approval identity before acceptance.

### Validation response

Validation returns structured issues tied to builder entities:

```json
{
  "data": {
    "valid": false,
    "issues": [
      {
        "code": "UNRESOLVED_APPROVER_INVITATION",
        "severity": "ERROR",
        "entityType": "STAGE_APPROVER",
        "entityId": "uuid",
        "path": "stages.1.approvers.0",
        "message": "The invited approver must join before publication."
      }
    ]
  },
  "meta": { "requestId": "uuid" }
}
```

Publication runs the same validation again inside its transaction and never
trusts a prior client validation result.

### Preview response

Preview accepts representative form answers and returns:

- Included stages in effective sequential order.
- Excluded conditional stages and safe condition summaries.
- Unresolved conditions when an answer is absent.
- Applicable level and total level count.
- The derived final applicable stage.
- Assignment labels, without creating runtime tasks.
- An automatic-approval result or a no-applicable-stage error.

Preview does not promise that dynamic membership assignments will resolve the
same way at a later submission.

`ROLE` and `DEPARTMENT_ROLE` previews describe every currently matching active
membership; submission performs the authoritative resolution.

## Request endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `POST` | `/organizations/:organizationId/requests` | List permitted requests or create a draft |
| `GET`, `PATCH` | `/organizations/:organizationId/requests/:requestId` | Read or update an editable request |
| `POST` | `/organizations/:organizationId/requests/:requestId/submit` | Validate and create the runtime journey |
| `POST` | `/organizations/:organizationId/requests/:requestId/resubmit` | Create a new runtime round after return |
| `POST` | `/organizations/:organizationId/requests/:requestId/cancel` | Cancel when the lifecycle policy permits |
| `GET` | `/organizations/:organizationId/requests/:requestId/history` | Read the authorized approval timeline |
| `GET` | `/organizations/:organizationId/requests/:requestId/approved-pdf` | Read approved-PDF metadata and delivery status |
| `GET` | `/organizations/:organizationId/requests/:requestId/approved-pdf/content` | Stream the canonical PDF for view, print, or download |
| `POST` | `/organizations/:organizationId/requests/:requestId/approved-pdf/retry` | Retry failed generation or initiator delivery |

Creating a draft requires `documentTypeId` and one
`originatingDepartmentId`. The department must be one of the initiator's active
departments. A draft may receive a non-final `temporaryReference`; it has no
`documentNumber` until formal submission.

Submission and resubmission require:

- `Idempotency-Key` header
- Expected request revision
- Published workflow version reference already bound to the request

A reused key with the same canonical command returns the stored response. The
same key with a different command returns `409 IDEMPOTENCY_KEY_REUSED`.

On first formal submission, the transaction allocates the number using the
document type's allowlisted format, for example
`FIN/FN/2026/000045`. Responses expose both the immutable UUID `id` and the
business-facing `documentNumber`. Resubmission retains the original document
number and never consumes another sequence value.

The submission transaction appends a durable `SUBMITTED` audit event and sets
the current status to `IN_REVIEW` before commit. Clients should not poll for or
depend on a resting `SUBMITTED` status.

The API does not expose an endpoint to mutate, release, or reuse an allocated
number. Department/document-type code changes affect later submissions only.
Codes used in issued numbers remain reserved to their original entities.
`{YEAR}` uses the configured business-calendar timezone. Sequence allocation
conflicts are handled inside the transaction and protected by database
uniqueness.

### Request detail progress

The request response includes high-level status and a runtime projection:

```json
{
  "status": "IN_REVIEW",
  "documentNumber": "FIN/FN/2026/000045",
  "documentType": { "id": "uuid", "name": "Fund Note", "code": "FN" },
  "originatingDepartment": { "id": "uuid", "name": "Finance", "code": "FIN" },
  "approvalProgress": {
    "round": 1,
    "currentLevel": 2,
    "totalLevels": 4,
    "currentStage": {
      "id": "uuid",
      "name": "Finance Manager Approval",
      "completionPolicy": "ANY",
      "dueAt": "2026-09-10T09:00:00Z",
      "assignees": [
        {
          "membershipId": "uuid",
          "displayName": "Anil Kumar",
          "email": "anil@example.com",
          "roleLabel": "Finance Manager",
          "departmentLabel": "Finance"
        }
      ]
    },
    "finalStage": {
      "id": "uuid",
      "name": "CEO Approval",
      "level": 4
    },
    "stages": []
  },
  "approvedPdf": null
}
```

Visibility of approver contact information is permission-aware. Public DTOs do
not expose internal token, role-binding, or database fields.

For an approved document, `approvedPdf` provides tracked state:

```json
{
  "approvalRoundId": "uuid",
  "status": "READY",
  "generatedAt": "2026-09-10T12:00:00Z",
  "contentSha256": "hex-encoded-sha256",
  "rendererVersion": "1",
  "pageCount": 6,
  "deliveryMode": "ATTACHMENT",
  "deliveryStatus": "DELIVERED",
  "deliveredAt": "2026-09-10T12:01:00Z"
}
```

The approved-PDF content endpoint requires the same tenant and document-read
policy as the document. It supports allowlisted
`disposition=inline|attachment` and `purpose=view|print|download` queries and
returns safe `Content-Type` and `Content-Disposition` headers. The purpose is
audited; `print` records intent to open the browser print dialog, not proof of
physical printing. The API does not expose an object-storage key or permanent
public URL. If a short-lived access grant is used, it is audience-, purpose-, and
organization-bound and expires after five minutes by default.

Retry requires `approved_pdf.retry` and a body selecting `PDF_GENERATION` or
`INITIATOR_DELIVERY`. It acts on the existing `FAILED` or
`PERMANENTLY_FAILED` record, verifies that the underlying problem is eligible for
retry, is rate-limited, and creates an audit event.

## Document-type dashboards

Each document type has a distinct route and API scope while sharing one typed
dashboard contract. The dashboard endpoint returns real status counts,
due/overdue counts, and a cursor-paginated document collection filtered by the
path `documentTypeId`. Supported filters include document number, initiator,
originating department, status, current stage, and date.

Each approved row includes canonical PDF readiness and initiator email-delivery
status plus permission-aware **View**, **Print**, **Download**, and **Retry**
capabilities. Documents appear as soon as approval commits; pending artifacts
show `GENERATING` or `PENDING` rather than placeholder data.

The initiator may see the high-level status of their own final delivery.
Detailed error codes, attempts, reconciliation fields, and retry/reopen
capabilities require `approved_pdf.retry`.

Dashboard row scope is the union of permissions held by the caller:

- `request.read_all`: all documents of the selected type.
- `request.read_department`: documents from the caller's active departments.
- `request.read_own`: documents initiated by the caller.
- `approval.read_assigned`: documents containing a task assigned to the caller.

The default query uses the current calendar year, excludes `CANCELLED`, sorts by
`updatedAt desc`, and returns 25 cursor-paginated rows; `limit` is capped at 100.
Allowlisted sorts are document number, created/submitted/approved/updated time,
status, and current stage. Metrics use the same scope and filters and return
total, draft, in-review, returned, approved, rejected, overdue, PDF pending/
failed, and delivery-failed counts.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `PUT` | `/organizations/:organizationId/document-types/:documentTypeId/dashboard-config` | Read or update allowlisted dashboard columns/defaults |
| `POST` | `/organizations/:organizationId/document-types/:documentTypeId/dashboard-export` | Export the current authorized filter set as CSV |

Document-type administrators select default columns from safe system columns and
explicitly non-sensitive form fields. Personal choices cannot escape that
allowlist. CSV export uses identical row/field authorization, is audited, and is
capped at 10,000 rows. Export additionally requires `request.export`.

## Approval-task endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/organizations/:organizationId/approval-tasks` | Paginated assigned-task inbox |
| `GET` | `/organizations/:organizationId/approval-tasks/:taskId` | Read an assigned/authorized task |
| `POST` | `/organizations/:organizationId/approval-tasks/:taskId/approve` | Approve a pending task |
| `POST` | `/organizations/:organizationId/approval-tasks/:taskId/reject` | Reject with a required comment |
| `POST` | `/organizations/:organizationId/approval-tasks/:taskId/return` | Return with a required comment |
| `POST` | `/organizations/:organizationId/approval-tasks/:taskId/reassign` | Explicitly reassign a pending task |

All decision endpoints require `Idempotency-Key`. They verify that the acting
membership is the specific resolved task assignee, the task belongs to the
current round and active stage, and self-approval is allowed when relevant.
Stale or concurrently superseded tasks return a typed conflict.

A human rejection immediately transitions the document to `REJECTED`. A human
return immediately transitions it to `RETURNED` and restores responsibility to
the initiator. Resubmission always creates a new round, reevaluates all
conditions and assignments, and restarts from the first applicable stage while
preserving earlier rounds.

Reassignment requires `approval.reassign`, an idempotency key, a replacement
active same-tenant `membershipId`, and a reason. It closes rather than overwrites
the original task, creates a linked replacement, records the actor and reason,
and queues the ordinary assignment email. Role or department changes never
silently re-resolve an active runtime stage.

## Audit endpoint

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/organizations/:organizationId/audit-events` | Paginated, filtered authorized audit feed |

Filters are allowlisted and bounded. Audit records are not mutable through the
public API.

## Notification behavior

Every approval decision reevaluates the stage. When `ANY` or `ALL` is satisfied,
submission or human/system stage completion identifies and activates the next
applicable stage in the state-change transaction. Activation writes one
outbox event per deduplicated resolved membership. The resulting email includes:

- Approver name and snapshotted role label
- Document type and immutable reference number
- Submitter's name
- Current approval status and stage
- Required action
- Due date when configured
- Secure **Review Document** link

The link contains a same-origin document approval route, not an access, refresh,
or reusable approval token. An unauthenticated recipient is redirected to sign
in with a server-validated return path, then returned to the requested approval
page. The API rechecks membership, task assignment, permission, and current task
state before returning protected data or accepting a decision.

When the final stage completes, the approval transaction creates one pending
canonical artifact, snapshots the logical recipient deliveries, and queues PDF
generation. Only after the artifact is ready does the system queue provider
submission for the eligible initiator. The recipient is only the initiator's current verified
account email captured at final approval, and the membership must be active.
Suspended, inactive, or unverified initiators produce a
`PERMANENTLY_FAILED` record without a provider call. Submission-time and current
emails are never both used.

The worker rechecks membership and verifies that the snapshot is still the
current verified account email before provider submission. Later suspension,
unverification, or email change prevents sending. Authorized reopen updates the
same record to the restored current verified address.

Configured completion recipients receive a secure authenticated link only. The
eligible initiator receives the PDF attachment unless it exceeds the configured
provider limit, default 10 MiB; then `deliveryMode` is `SECURE_LINK`, no
attachment is included, and `attachmentOmissionReason` is `SIZE_LIMIT`.

Automatic approval of a final overdue stage uses the identical artifact and
delivery flow and produces a
`System Auto-Approved` audit entry. Notification and PDF workers are not invoked
inside database transactions.

Approved-PDF metadata response states are:

- Generation: `PENDING`, `GENERATING`, `READY`, `FAILED`, or `DELETED`.
- Delivery: `PENDING`, `SENDING`, `DELIVERED`, `FAILED`, or
  `PERMANENTLY_FAILED`.

Failures return safe codes, attempt counts, and next retry time to authorized
operators. Internal exception text and provider responses are not exposed.

The API guarantees one logical delivery record. Provider submission is at least
once and uses an idempotency key where supported. Unknown timeouts remain
`SENDING` for provider reconciliation; confirmed retryable failures become
`FAILED`; hard bounces, definitive rejection, ineligible recipients, and retry
exhaustion become `PERMANENTLY_FAILED`.

Review escalations expose only `NOTIFY` and `RETURN_TO_INITIATOR`. The latter is
a system state transition to `RETURNED`, not an approval-task reassignment to the
initiator.

## Operational endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health/live` | Process liveness |
| `GET` | `/health/ready` | Required dependency readiness |
| `GET` | `/openapi.json` | OpenAPI contract |
| `GET` | `/docs` | API documentation UI |

Health responses expose no credentials or detailed internal topology.

## Expected status and error behavior

- `400`: malformed input or invalid workflow definition.
- `401`: missing or invalid authentication.
- `403`: authenticated but insufficient permission/policy.
- `404`: resource unavailable within the tenant scope.
- `409`: revision, idempotency, state-transition, or concurrent-action conflict.
- `422`: semantically invalid form answers or publication configuration.
- `429`: rate limit exceeded.
- `500`: generic unexpected failure with request ID.

The exact `400` versus `422` split will be standardized before implementation
and applied consistently across OpenAPI and tests.
