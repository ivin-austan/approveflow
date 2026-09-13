# ApproveFlow Operations Runbook

## Scope and ownership

This runbook covers the API, web application, PostgreSQL database, Redis/BullMQ,
private approved-artifact storage, and the configured transactional email
provider. A named incident commander must own every production incident. A
separate approval is required before deployment or production migrations.

## Release and migration procedure

1. Run `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm lint`,
   `pnpm typecheck`, `pnpm test`, and `pnpm build` from a clean checkout.
2. Review every generated SQL migration. Destructive statements require an
   explicit product and operations approval.
3. Take and verify a PostgreSQL backup before applying migrations.
4. Apply migrations once through the release job using `drizzle-kit migrate`.
   Never use schema push in production.
5. Verify `/api/v1/health`, authentication, tenant context, request listing,
   approval inbox, outbox age, and worker heartbeats before directing traffic.
6. Roll back application binaries if health checks fail. Database rollback must
   use a separately reviewed compensating migration; never rewrite migration
   history.

## Backup and recovery

- PostgreSQL: encrypted daily full backups plus continuous WAL archiving. Retain
  daily backups for 35 days and monthly backups for at least 13 months.
- Approved artifacts: provider-side encryption, versioning, and cross-account
  backup. Preserve tenant object prefixes and recorded SHA-256 values.
- Redis is not authoritative. Rebuild queues from committed outbox and delivery
  records after loss.
- Store backup encryption keys outside the backup account and rotate them under
  dual control.
- Run a quarterly restore exercise into an isolated account. Restore the
  database and artifacts, verify migration level, sample tenant boundaries,
  compare stored artifact hashes, and record recovery-point and recovery-time
  results.
- Legal holds override retention deletion. Recovery must not revive an artifact
  whose append-only deletion audit proves it was intentionally removed unless
  legal and security owners approve the exception.

## Monitoring and alerts

Export counters, histograms, and oldest-item gauges without organization names,
emails, document content, tokens, or storage keys.

| Signal | Warning | Critical |
| --- | ---: | ---: |
| Oldest pending outbox event | 2 minutes | 10 minutes |
| Oldest scheduled stage action | 2 minutes overdue | 10 minutes overdue |
| PDF generation p95 | 30 seconds | 2 minutes |
| PDF permanently failed | 1 in 15 minutes | 5 in 15 minutes |
| Notification/delivery queue age | 5 minutes | 20 minutes |
| Delivery permanent failures | 2% over 30 minutes | 10% over 15 minutes |
| Expired generation/send leases | 1 | 10 |
| Artifact hash mismatch | immediate | immediate page |
| Dashboard p95 | 1 second | 3 seconds |
| HTTP 5xx rate | 1% over 10 minutes | 5% over 5 minutes |

Alert on retry exhaustion separately from transient retries. Dashboard query
alerts must include the allowlisted sort and row-scope category, never search
text. Worker startup and graceful shutdown should emit a heartbeat/status event
to the monitoring platform.

## Incident response

1. Declare severity and assign incident commander, communications owner, and
   technical lead.
2. Preserve logs and audit records. Do not modify append-only audit events.
3. Contain tenant leakage by disabling the affected route or permission; never
   weaken authorization to restore availability.
4. For stuck jobs, inspect committed state and lease expiry before retrying.
   Use permission-protected reopen/retry commands rather than direct SQL.
5. For provider timeouts, allow reconciliation to run before resubmission.
6. For hash mismatch, disable artifact serving, preserve both metadata and
   object bytes, and begin recovery from a verified backup.
7. Notify affected customers and regulators according to contractual and legal
   timelines.
8. Record a blameless post-incident review with timeline, root cause,
   tenant-impact analysis, corrective actions, and owners.

## Log handling

Authorization/cookie headers, passwords, refresh tokens, artifact access
tokens, email-provider credentials, email addresses, document content, and
storage keys must be redacted. Production log access is least-privilege and
audited. Correlation IDs accept only the server allowlist format.

## Capacity and performance baseline

Before release, record p50/p95/p99 latency and database plans for request lists,
approval inbox, dashboard list/export, submission, and concurrent decisions at
representative tenant sizes. The release record must state dataset size,
concurrency, hardware, commit, migration level, and test commands. Re-run the
baseline when indexes, query shapes, or row-scope policies change.
