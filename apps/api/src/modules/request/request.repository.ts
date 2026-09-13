import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  approvalRounds,
  approvalTasks,
  auditEvents,
  departments,
  documentTypes,
  fieldConditions,
  fieldOptions,
  formFields,
  formSections,
  idempotencyRecords,
  membershipDepartments,
  membershipRoles,
  memberships,
  outboxEvents,
  requestAnswers,
  requestNumberAllocations,
  requestNumberSequences,
  requests,
  runtimeStages,
  schema as databaseSchema,
  stageApprovers,
  users,
  workflowStages,
  workflowVersions,
  workflows,
} from "@approveflow/database";
import { conditionSchema, evaluateCondition } from "../workflow/condition.js";
import type {
  RequestForm,
  RequestRepository,
  RequestSummary,
} from "./request.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleRequestRepository implements RequestRepository {
  public constructor(private readonly database: Database) {}

  public async list(organizationId: string, membershipId: string) {
    const rows = await this.database
      .select({
        id: requests.id,
        requestNumber: requests.requestNumber,
        title: requests.title,
        status: requests.status,
        revision: requests.revision,
        submittedAt: requests.submittedAt,
        updatedAt: requests.updatedAt,
      })
      .from(requests)
      .where(
        and(
          eq(requests.organizationId, organizationId),
          eq(requests.requesterMembershipId, membershipId),
        ),
      )
      .orderBy(desc(requests.updatedAt));
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        currentStage: await this.currentStage(organizationId, row.id),
      })),
    );
  }

  public async get(
    organizationId: string,
    membershipId: string,
    requestId: string,
  ) {
    const [row] = await this.database
      .select({
        id: requests.id,
        requestNumber: requests.requestNumber,
        title: requests.title,
        status: requests.status,
        revision: requests.revision,
        submittedAt: requests.submittedAt,
        updatedAt: requests.updatedAt,
      })
      .from(requests)
      .where(
        and(
          eq(requests.organizationId, organizationId),
          eq(requests.id, requestId),
          eq(requests.requesterMembershipId, membershipId),
        ),
      );
    return row
      ? {
          ...row,
          currentStage: await this.currentStage(organizationId, row.id),
        }
      : null;
  }

  public async getForm(
    organizationId: string,
    workflowId: string,
    pinnedVersionId?: string,
  ): Promise<RequestForm | null> {
    const [workflow] = await this.database
      .select({
        id: workflows.id,
        name: workflows.name,
        versionId: pinnedVersionId
          ? sql<string>`${pinnedVersionId}`
          : workflows.currentPublishedVersionId,
      })
      .from(workflows)
      .where(
        and(
          eq(workflows.organizationId, organizationId),
          eq(workflows.id, workflowId),
          eq(workflows.status, "ACTIVE"),
        ),
      );
    if (!workflow?.versionId) return null;
    const [version] = await this.database
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.organizationId, organizationId),
          eq(workflowVersions.id, workflow.versionId),
          pinnedVersionId
            ? inArray(workflowVersions.status, ["PUBLISHED", "RETIRED"])
            : eq(workflowVersions.status, "PUBLISHED"),
        ),
      );
    if (!version) return null;
    const sections = await this.database
      .select()
      .from(formSections)
      .where(
        and(
          eq(formSections.organizationId, organizationId),
          eq(formSections.workflowVersionId, version.id),
        ),
      )
      .orderBy(asc(formSections.position));
    const fields = await this.database
      .select()
      .from(formFields)
      .where(
        and(
          eq(formFields.organizationId, organizationId),
          eq(formFields.workflowVersionId, version.id),
        ),
      )
      .orderBy(asc(formFields.position));
    const fieldIds = fields.map((field) => field.id);
    const options = fieldIds.length
      ? await this.database
          .select()
          .from(fieldOptions)
          .where(
            and(
              eq(fieldOptions.organizationId, organizationId),
              inArray(fieldOptions.formFieldId, fieldIds),
            ),
          )
          .orderBy(asc(fieldOptions.position))
      : [];
    const conditions = await this.database
      .select()
      .from(fieldConditions)
      .where(
        and(
          eq(fieldConditions.organizationId, organizationId),
          eq(fieldConditions.workflowVersionId, version.id),
        ),
      );
    return {
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowName: workflow.name,
      sections: sections.map((section) => ({
        id: section.id,
        name: section.name,
        description: section.description,
        fields: fields
          .filter((field) => field.formSectionId === section.id)
          .map((field) => ({
            id: field.id,
            type: field.type,
            label: field.label,
            required: field.isRequired,
            optionValues: options
              .filter((option) => option.formFieldId === field.id)
              .map((option) => option.stableValue),
          })),
      })),
      conditions: conditions.map((item) => ({
        targetFieldId: item.targetFormFieldId,
        effect: item.effect,
        condition: conditionSchema.parse(item.condition),
      })),
    };
  }

  public async createDraft(
    input: Parameters<RequestRepository["createDraft"]>[0],
  ) {
    const [workflow] = await this.database
      .select({ documentTypeId: workflows.documentTypeId })
      .from(workflows)
      .where(
        and(
          eq(workflows.organizationId, input.organizationId),
          eq(workflows.id, input.workflowId),
          eq(workflows.currentPublishedVersionId, input.workflowVersionId),
        ),
      );
    if (!workflow)
      throw new Error("Published workflow changed before draft creation");
    await this.database.transaction(async (transaction) => {
      await transaction.insert(requests).values({
        id: input.id,
        organizationId: input.organizationId,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId,
        documentTypeId: workflow.documentTypeId,
        requesterMembershipId: input.membershipId,
        title: input.title,
      });
      const entries = Object.entries(input.answers);
      if (entries.length)
        await transaction.insert(requestAnswers).values(
          entries.map(([formFieldId, value]) => ({
            organizationId: input.organizationId,
            requestId: input.id,
            formFieldId,
            value,
          })),
        );
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: input.id,
        actorMembershipId: input.membershipId,
        eventType: "DRAFT_CREATED",
        payload: {},
      });
    });
  }

  public async updateDraft(
    input: Parameters<RequestRepository["updateDraft"]>[0],
  ) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ status: requests.status, revision: requests.revision })
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, input.organizationId),
            eq(requests.id, input.requestId),
            eq(requests.requesterMembershipId, input.membershipId),
          ),
        )
        .for("update");
      if (!existing) return "NOT_FOUND" as const;
      if (existing.status !== "DRAFT") return "IMMUTABLE" as const;
      if (existing.revision !== input.expectedRevision)
        return "CONFLICT" as const;
      await transaction
        .update(requests)
        .set({
          title: input.title,
          revision: input.expectedRevision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(requests.organizationId, input.organizationId),
            eq(requests.id, input.requestId),
          ),
        );
      await transaction
        .delete(requestAnswers)
        .where(
          and(
            eq(requestAnswers.organizationId, input.organizationId),
            eq(requestAnswers.requestId, input.requestId),
          ),
        );
      const entries = Object.entries(input.answers);
      if (entries.length)
        await transaction.insert(requestAnswers).values(
          entries.map(([formFieldId, value]) => ({
            organizationId: input.organizationId,
            requestId: input.requestId,
            formFieldId,
            value,
          })),
        );
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: input.requestId,
        actorMembershipId: input.membershipId,
        eventType: "DRAFT_UPDATED",
        payload: { revision: input.expectedRevision + 1 },
      });
      return "UPDATED" as const;
    });
  }

  public async getDraftForSubmission(
    organizationId: string,
    membershipId: string,
    requestId: string,
  ) {
    const [request] = await this.database
      .select({
        workflowId: requests.workflowId,
        revision: requests.revision,
        status: requests.status,
        originatingDepartmentId: requests.originatingDepartmentId,
      })
      .from(requests)
      .where(
        and(
          eq(requests.organizationId, organizationId),
          eq(requests.id, requestId),
          eq(requests.requesterMembershipId, membershipId),
          inArray(requests.status, ["DRAFT", "RETURNED"]),
        ),
      );
    if (!request) return null;
    const form = await this.getFormForVersion(
      organizationId,
      request.workflowId,
      requestId,
    );
    if (!form) return null;
    const answers = await this.database
      .select({
        fieldId: requestAnswers.formFieldId,
        value: requestAnswers.value,
      })
      .from(requestAnswers)
      .where(
        and(
          eq(requestAnswers.organizationId, organizationId),
          eq(requestAnswers.requestId, requestId),
        ),
      );
    return {
      revision: request.revision,
      status:
        request.status === "RETURNED"
          ? ("RETURNED" as const)
          : ("DRAFT" as const),
      originatingDepartmentId: request.originatingDepartmentId,
      form,
      answers: Object.fromEntries(
        answers.map((answer) => [answer.fieldId, answer.value]),
      ),
    };
  }

  public async submit(input: Parameters<RequestRepository["submit"]>[0]) {
    return this.database.transaction(async (transaction) => {
      // The request lock serializes every submit attempt for this aggregate,
      // including concurrent calls whose idempotency row does not exist yet.
      const [request] = await transaction
        .select()
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, input.organizationId),
            eq(requests.id, input.requestId),
            eq(requests.requesterMembershipId, input.membershipId),
          ),
        )
        .for("update");
      if (!request) return { outcome: "NOT_FOUND" as const };
      const [prior] = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.organizationId, input.organizationId),
            eq(idempotencyRecords.actorMembershipId, input.membershipId),
            eq(
              idempotencyRecords.operation,
              `request.submit:${input.requestId}`,
            ),
            eq(idempotencyRecords.key, input.idempotencyKey),
          ),
        )
        .for("update");
      if (prior) {
        if (prior.requestHash !== input.requestHash)
          return { outcome: "IDEMPOTENCY_MISMATCH" as const };
        const replay = await this.get(
          input.organizationId,
          input.membershipId,
          input.requestId,
        );
        return replay
          ? { outcome: "REPLAY" as const, request: replay }
          : { outcome: "NOT_FOUND" as const };
      }
      if (
        (request.status !== "DRAFT" && request.status !== "RETURNED") ||
        request.revision !== input.expectedRevision
      )
        return { outcome: "CONFLICT" as const };
      const [department] = await transaction
        .select()
        .from(departments)
        .innerJoin(
          membershipDepartments,
          and(
            eq(
              membershipDepartments.organizationId,
              departments.organizationId,
            ),
            eq(membershipDepartments.departmentId, departments.id),
          ),
        )
        .where(
          and(
            eq(departments.organizationId, input.organizationId),
            eq(departments.id, input.originatingDepartmentId),
            eq(departments.status, "ACTIVE"),
            eq(membershipDepartments.membershipId, input.membershipId),
          ),
        );
      if (!department) return { outcome: "INVALID_DEPARTMENT" as const };
      const [version] = await transaction
        .select()
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.organizationId, input.organizationId),
            eq(workflowVersions.id, request.workflowVersionId),
            inArray(workflowVersions.status, ["PUBLISHED", "RETIRED"]),
          ),
        );
      if (!version) return { outcome: "NOT_FOUND" as const };
      const answerRows = await transaction
        .select({
          fieldId: requestAnswers.formFieldId,
          value: requestAnswers.value,
        })
        .from(requestAnswers)
        .where(
          and(
            eq(requestAnswers.organizationId, input.organizationId),
            eq(requestAnswers.requestId, input.requestId),
          ),
        );
      const answers = Object.fromEntries(
        answerRows.map((answer) => [answer.fieldId, answer.value]),
      );
      const stages = await transaction
        .select()
        .from(workflowStages)
        .where(
          and(
            eq(workflowStages.organizationId, input.organizationId),
            eq(workflowStages.workflowVersionId, version.id),
          ),
        )
        .orderBy(asc(workflowStages.position));
      const applicable = stages.filter(
        (stage) =>
          !stage.activationCondition ||
          evaluateCondition(
            conditionSchema.parse(stage.activationCondition),
            answers,
          ) === "MATCHED",
      );
      if (!applicable.length) {
        if (!version.allowNoStageAutomaticApproval)
          return { outcome: "NO_APPLICABLE_STAGE" as const };
        await this.createIdempotencyRecord(transaction, input);
        return this.completeAutomatic(
          transaction,
          input,
          request,
          department.departments.code,
        );
      }
      const resolved = [];
      for (const stage of applicable) {
        const assignments = await transaction
          .select()
          .from(stageApprovers)
          .where(
            and(
              eq(stageApprovers.organizationId, input.organizationId),
              eq(stageApprovers.workflowStageId, stage.id),
            ),
          )
          .orderBy(asc(stageApprovers.displayOrder));
        const members = await this.resolveMembers(
          transaction,
          input.organizationId,
          input.membershipId,
          assignments,
          answers,
        );
        if (!members.length)
          return { outcome: "NO_ELIGIBLE_APPROVER" as const };
        resolved.push({ stage, members });
      }
      await this.createIdempotencyRecord(transaction, input);
      const resubmission = request.status === "RETURNED";
      const requestNumber = resubmission
        ? request.requestNumber
        : await this.allocateNumber(
            transaction,
            request,
            input.originatingDepartmentId,
            department.departments.code,
          );
      if (!requestNumber)
        throw new Error("Submitted request number is missing");
      const now = new Date();
      const priorRounds = resubmission
        ? await transaction
            .select({ roundNumber: approvalRounds.roundNumber })
            .from(approvalRounds)
            .where(
              and(
                eq(approvalRounds.organizationId, input.organizationId),
                eq(approvalRounds.requestId, input.requestId),
              ),
            )
            .orderBy(desc(approvalRounds.roundNumber))
            .limit(1)
        : [];
      const roundNumber = (priorRounds[0]?.roundNumber ?? 0) + 1;
      if (resubmission)
        await transaction
          .update(approvalRounds)
          .set({ status: "SUPERSEDED" })
          .where(
            and(
              eq(approvalRounds.organizationId, input.organizationId),
              eq(approvalRounds.requestId, input.requestId),
              eq(approvalRounds.status, "COMPLETED"),
            ),
          );
      const [round] = await transaction
        .insert(approvalRounds)
        .values({
          organizationId: input.organizationId,
          requestId: input.requestId,
          roundNumber,
        })
        .returning();
      if (!round) throw new Error("Approval round creation failed");
      for (const [index, item] of resolved.entries()) {
        const active = index === 0;
        const [runtime] = await transaction
          .insert(runtimeStages)
          .values({
            organizationId: input.organizationId,
            requestId: input.requestId,
            approvalRoundId: round.id,
            sourceWorkflowStageId: item.stage.id,
            levelNumber: index + 1,
            name: item.stage.name,
            description: item.stage.description,
            instructions: item.stage.instructions,
            completionPolicy: item.stage.completionPolicy,
            isFinal: index === resolved.length - 1,
            status: active ? "ACTIVE" : "PENDING",
            activatedAt: active ? now : null,
          })
          .returning();
        if (!runtime) throw new Error("Runtime stage creation failed");
        await transaction.insert(approvalTasks).values(
          item.members.map((member) => ({
            organizationId: input.organizationId,
            requestId: input.requestId,
            runtimeStageId: runtime.id,
            assignedMembershipId: member.id,
            assigneeName: member.name,
            assigneeEmail: member.email,
            status: active ? ("ACTIVE" as const) : ("PENDING" as const),
            activatedAt: active ? now : null,
          })),
        );
      }
      await transaction
        .update(requests)
        .set({
          status: "IN_REVIEW",
          requestNumber,
          originatingDepartmentId: input.originatingDepartmentId,
          submittedAt: request.submittedAt ?? now,
          completedAt: null,
          revision: request.revision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(requests.organizationId, input.organizationId),
            eq(requests.id, input.requestId),
          ),
        );
      await this.recordSubmission(
        transaction,
        input,
        requestNumber,
        resubmission,
      );
      const summary: RequestSummary = {
        id: request.id,
        requestNumber,
        title: request.title,
        status: "IN_REVIEW",
        revision: request.revision + 1,
        currentStage: resolved[0]?.stage.name ?? null,
        submittedAt: request.submittedAt ?? now,
        updatedAt: now,
      };
      await transaction
        .update(idempotencyRecords)
        .set({
          status: "COMPLETED",
          responseStatus: 200,
          responseBody: { requestId: request.id },
          updatedAt: now,
        })
        .where(
          and(
            eq(idempotencyRecords.organizationId, input.organizationId),
            eq(idempotencyRecords.actorMembershipId, input.membershipId),
            eq(
              idempotencyRecords.operation,
              `request.submit:${input.requestId}`,
            ),
            eq(idempotencyRecords.key, input.idempotencyKey),
          ),
        );
      return { outcome: "SUBMITTED" as const, request: summary };
    });
  }

  private async getFormForVersion(
    organizationId: string,
    workflowId: string,
    requestId: string,
  ) {
    const [request] = await this.database
      .select({ versionId: requests.workflowVersionId })
      .from(requests)
      .where(
        and(
          eq(requests.organizationId, organizationId),
          eq(requests.id, requestId),
          eq(requests.workflowId, workflowId),
        ),
      );
    if (!request) return null;
    return this.getForm(organizationId, workflowId, request.versionId);
  }

  private async currentStage(organizationId: string, requestId: string) {
    const [stage] = await this.database
      .select({ name: runtimeStages.name })
      .from(runtimeStages)
      .where(
        and(
          eq(runtimeStages.organizationId, organizationId),
          eq(runtimeStages.requestId, requestId),
          eq(runtimeStages.status, "ACTIVE"),
        ),
      );
    return stage?.name ?? null;
  }

  private async resolveMembers(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    organizationId: string,
    requesterId: string,
    assignments: readonly (typeof stageApprovers.$inferSelect)[],
    answers: Readonly<Record<string, unknown>>,
  ) {
    const ids = new Set<string>();
    for (const assignment of assignments) {
      if (assignment.assignmentType === "MEMBERSHIP" && assignment.membershipId)
        ids.add(assignment.membershipId);
      else if (
        assignment.assignmentType === "FORM_FIELD_USER" &&
        assignment.formFieldId
      ) {
        const answer = answers[assignment.formFieldId];
        if (typeof answer === "string") ids.add(answer);
      } else if (assignment.assignmentType === "REQUESTER_MANAGER") {
        const [requester] = await transaction
          .select({ id: memberships.reportingManagerMembershipId })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.id, requesterId),
            ),
          );
        if (requester?.id) ids.add(requester.id);
      } else if (assignment.roleId) {
        const rows = await transaction
          .select({ id: memberships.id })
          .from(memberships)
          .innerJoin(
            membershipRoles,
            and(
              eq(membershipRoles.organizationId, memberships.organizationId),
              eq(membershipRoles.membershipId, memberships.id),
            ),
          )
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.status, "ACTIVE"),
              eq(membershipRoles.roleId, assignment.roleId),
            ),
          );
        for (const row of rows) ids.add(row.id);
        if (
          assignment.assignmentType === "DEPARTMENT_ROLE" &&
          assignment.departmentId
        ) {
          const eligible = await transaction
            .select({ id: membershipDepartments.membershipId })
            .from(membershipDepartments)
            .where(
              and(
                eq(membershipDepartments.organizationId, organizationId),
                eq(membershipDepartments.departmentId, assignment.departmentId),
              ),
            );
          const allowed = new Set(eligible.map((row) => row.id));
          for (const id of [...ids]) if (!allowed.has(id)) ids.delete(id);
        }
      }
    }
    if (!ids.size) return [];
    return transaction
      .select({ id: memberships.id, name: users.fullName, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "ACTIVE"),
          inArray(memberships.id, [...ids]),
        ),
      );
  }

  private async allocateNumber(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    request: typeof requests.$inferSelect,
    departmentId: string,
    departmentCode: string,
  ) {
    const [documentType] = await transaction
      .select()
      .from(documentTypes)
      .where(
        and(
          eq(documentTypes.organizationId, request.organizationId),
          eq(documentTypes.id, request.documentTypeId),
        ),
      );
    if (!documentType) throw new Error("Document type missing");
    const year = new Date().getUTCFullYear();
    await transaction
      .insert(requestNumberSequences)
      .values({
        organizationId: request.organizationId,
        documentTypeId: request.documentTypeId,
        departmentId,
        calendarYear: year,
      })
      .onConflictDoNothing();
    const [sequence] = await transaction
      .select()
      .from(requestNumberSequences)
      .where(
        and(
          eq(requestNumberSequences.organizationId, request.organizationId),
          eq(requestNumberSequences.documentTypeId, request.documentTypeId),
          eq(requestNumberSequences.departmentId, departmentId),
          eq(requestNumberSequences.calendarYear, year),
        ),
      )
      .for("update");
    if (!sequence) throw new Error("Number sequence creation failed");
    await transaction
      .update(requestNumberSequences)
      .set({
        nextValue: sql`${requestNumberSequences.nextValue} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(requestNumberSequences.id, sequence.id));
    const formatted = documentType.numberFormat
      .replaceAll("{DEPARTMENT_CODE}", departmentCode)
      .replaceAll("{DOCUMENT_TYPE_CODE}", documentType.code)
      .replaceAll("{YEAR}", String(year))
      .replaceAll(
        "{SEQUENCE}",
        sequence.nextValue
          .toString()
          .padStart(documentType.sequencePadding, "0"),
      );
    await transaction.insert(requestNumberAllocations).values({
      organizationId: request.organizationId,
      sequenceId: sequence.id,
      requestId: request.id,
      allocatedValue: sequence.nextValue,
      formattedNumber: formatted,
    });
    return formatted;
  }

  private async recordSubmission(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: Parameters<RequestRepository["submit"]>[0],
    requestNumber: string,
    resubmission = false,
  ) {
    await transaction.insert(auditEvents).values({
      organizationId: input.organizationId,
      requestId: input.requestId,
      actorMembershipId: input.membershipId,
      eventType: resubmission ? "RESUBMITTED" : "SUBMITTED",
      payload: { requestNumber },
    });
    await transaction.insert(outboxEvents).values({
      organizationId: input.organizationId,
      aggregateType: "REQUEST",
      aggregateId: input.requestId,
      eventType: resubmission ? "REQUEST_RESUBMITTED" : "REQUEST_SUBMITTED",
      payload: { requestNumber },
    });
  }

  private async createIdempotencyRecord(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: Parameters<RequestRepository["submit"]>[0],
  ) {
    await transaction.insert(idempotencyRecords).values({
      organizationId: input.organizationId,
      actorMembershipId: input.membershipId,
      operation: `request.submit:${input.requestId}`,
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }

  private async completeAutomatic(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: Parameters<RequestRepository["submit"]>[0],
    request: typeof requests.$inferSelect,
    departmentCode: string,
  ) {
    const resubmission = request.status === "RETURNED";
    const requestNumber = resubmission
      ? request.requestNumber
      : await this.allocateNumber(
          transaction,
          request,
          input.originatingDepartmentId,
          departmentCode,
        );
    if (!requestNumber) throw new Error("Submitted request number is missing");
    const now = new Date();
    await transaction
      .update(requests)
      .set({
        status: "APPROVED",
        requestNumber,
        originatingDepartmentId: input.originatingDepartmentId,
        submittedAt: request.submittedAt ?? now,
        completedAt: now,
        revision: request.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(requests.organizationId, input.organizationId),
          eq(requests.id, input.requestId),
        ),
      );
    await this.recordSubmission(
      transaction,
      input,
      requestNumber,
      resubmission,
    );
    await transaction.insert(auditEvents).values({
      organizationId: input.organizationId,
      requestId: input.requestId,
      actorMembershipId: null,
      eventType: "AUTOMATICALLY_APPROVED",
      payload: {},
    });
    const summary: RequestSummary = {
      id: request.id,
      requestNumber,
      title: request.title,
      status: "APPROVED",
      revision: request.revision + 1,
      currentStage: null,
      submittedAt: request.submittedAt ?? now,
      updatedAt: now,
    };
    await transaction
      .update(idempotencyRecords)
      .set({
        status: "COMPLETED",
        responseStatus: 200,
        responseBody: { requestId: request.id },
        updatedAt: now,
      })
      .where(
        and(
          eq(idempotencyRecords.organizationId, input.organizationId),
          eq(idempotencyRecords.actorMembershipId, input.membershipId),
          eq(idempotencyRecords.operation, `request.submit:${input.requestId}`),
          eq(idempotencyRecords.key, input.idempotencyKey),
        ),
      );
    return { outcome: "SUBMITTED" as const, request: summary };
  }
}
