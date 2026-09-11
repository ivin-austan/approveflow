import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  formFields,
  memberships,
  roles,
  departments,
  schema as databaseSchema,
  stageApprovers,
  workflowStages,
  workflowVersions,
  workflows,
} from "@approveflow/database";
import { conditionSchema } from "./condition.js";
import type {
  StoredDraft,
  ValidationIssue,
  WorkflowRepository,
} from "./workflow.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleWorkflowRepository implements WorkflowRepository {
  public constructor(private readonly database: Database) {}

  public async getDraft(
    organizationId: string,
    workflowId: string,
    versionId: string,
  ): Promise<StoredDraft | null> {
    const [version] = await this.database
      .select()
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.organizationId, organizationId),
          eq(workflowVersions.workflowId, workflowId),
          eq(workflowVersions.id, versionId),
          eq(workflowVersions.status, "DRAFT"),
        ),
      );
    if (!version) return null;
    const stages = await this.database
      .select()
      .from(workflowStages)
      .where(
        and(
          eq(workflowStages.organizationId, organizationId),
          eq(workflowStages.workflowVersionId, versionId),
        ),
      )
      .orderBy(asc(workflowStages.position));
    const stageIds = stages.map(({ id }) => id);
    const approvers =
      stageIds.length === 0
        ? []
        : await this.database
            .select()
            .from(stageApprovers)
            .where(
              and(
                eq(stageApprovers.organizationId, organizationId),
                inArray(stageApprovers.workflowStageId, stageIds),
              ),
            )
            .orderBy(asc(stageApprovers.displayOrder));
    return {
      workflowId,
      versionId,
      revision: version.revision,
      expectedRevision: version.revision,
      automaticApprovalEnabled: version.automaticApprovalEnabled,
      allowNoStageAutomaticApproval: version.allowNoStageAutomaticApproval,
      allowRequesterSelfApproval: version.allowRequesterSelfApproval,
      stages: stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        description: stage.description,
        instructions: stage.instructions,
        position: stage.position,
        completionPolicy: stage.completionPolicy,
        dueDuration:
          stage.dueDuration && stage.dueDurationUnit
            ? { value: stage.dueDuration, unit: stage.dueDurationUnit }
            : null,
        activationCondition: stage.activationCondition
          ? conditionSchema.parse(stage.activationCondition)
          : null,
        approvers: approvers
          .filter(({ workflowStageId }) => workflowStageId === stage.id)
          .map(toAssignment),
      })),
    };
  }

  public replaceDraft(
    input: Parameters<WorkflowRepository["replaceDraft"]>[0],
  ): Promise<"UPDATED" | "NOT_FOUND" | "CONFLICT" | "IMMUTABLE"> {
    return this.database.transaction(async (transaction) => {
      const [version] = await transaction
        .select({
          status: workflowVersions.status,
          revision: workflowVersions.revision,
        })
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.organizationId, input.organizationId),
            eq(workflowVersions.workflowId, input.workflowId),
            eq(workflowVersions.id, input.versionId),
          ),
        );
      if (!version) return "NOT_FOUND";
      if (version.status !== "DRAFT") return "IMMUTABLE";
      if (version.revision !== input.expectedRevision) return "CONFLICT";
      const [updated] = await transaction
        .update(workflowVersions)
        .set({
          revision: sql`${workflowVersions.revision} + 1`,
          allowRequesterSelfApproval:
            input.definition.allowRequesterSelfApproval,
          allowNoStageAutomaticApproval:
            input.definition.allowNoStageAutomaticApproval,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowVersions.organizationId, input.organizationId),
            eq(workflowVersions.id, input.versionId),
            eq(workflowVersions.status, "DRAFT"),
            eq(workflowVersions.revision, input.expectedRevision),
          ),
        )
        .returning({ id: workflowVersions.id });
      if (!updated) return "CONFLICT";
      await transaction
        .delete(workflowStages)
        .where(
          and(
            eq(workflowStages.organizationId, input.organizationId),
            eq(workflowStages.workflowVersionId, input.versionId),
          ),
        );
      for (const stage of input.definition.stages) {
        await transaction.insert(workflowStages).values({
          id: stage.id,
          organizationId: input.organizationId,
          workflowVersionId: input.versionId,
          name: stage.name,
          description: stage.description,
          instructions: stage.instructions,
          position: stage.position,
          completionPolicy: stage.completionPolicy,
          dueDuration: stage.dueDuration?.value,
          dueDurationUnit: stage.dueDuration?.unit,
          activationCondition: stage.activationCondition,
        });
        await transaction.insert(stageApprovers).values(
          stage.approvers.map((assignment) => ({
            id: assignment.id,
            organizationId: input.organizationId,
            workflowStageId: stage.id,
            assignmentType: assignment.assignmentType,
            membershipId:
              "membershipId" in assignment
                ? assignment.membershipId
                : undefined,
            invitationId:
              "invitationId" in assignment
                ? assignment.invitationId
                : undefined,
            roleId: "roleId" in assignment ? assignment.roleId : undefined,
            departmentId:
              "departmentId" in assignment
                ? assignment.departmentId
                : undefined,
            formFieldId:
              "formFieldId" in assignment ? assignment.formFieldId : undefined,
            displayOrder: assignment.displayOrder,
          })),
        );
      }
      return "UPDATED";
    });
  }

  public async validateReferences(
    organizationId: string,
    draft: StoredDraft,
  ): Promise<readonly ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const stage of draft.stages)
      for (const assignment of stage.approvers) {
        let valid = true;
        if (assignment.assignmentType === "MEMBERSHIP") {
          const membershipId = assignment.membershipId;
          valid = !membershipId
            ? false
            : (
                await this.database
                  .select({ id: memberships.id })
                  .from(memberships)
                  .where(
                    and(
                      eq(memberships.organizationId, organizationId),
                      eq(memberships.id, membershipId),
                      eq(memberships.status, "ACTIVE"),
                    ),
                  )
              ).length === 1;
        } else if (
          assignment.assignmentType === "ROLE" ||
          assignment.assignmentType === "DEPARTMENT_ROLE"
        ) {
          valid =
            (
              await this.database
                .select({ id: roles.id })
                .from(roles)
                .where(
                  and(
                    eq(roles.organizationId, organizationId),
                    eq(roles.id, assignment.roleId),
                    eq(roles.status, "ACTIVE"),
                  ),
                )
            ).length === 1;
        } else if (assignment.assignmentType === "FORM_FIELD_USER") {
          valid =
            (
              await this.database
                .select({ id: formFields.id })
                .from(formFields)
                .where(
                  and(
                    eq(formFields.organizationId, organizationId),
                    eq(formFields.workflowVersionId, draft.versionId),
                    eq(formFields.id, assignment.formFieldId),
                    eq(formFields.type, "MEMBER_SELECTOR"),
                  ),
                )
            ).length === 1;
        }
        if (!valid)
          issues.push({
            code:
              assignment.assignmentType === "MEMBERSHIP" &&
              assignment.invitationId
                ? "UNRESOLVED_APPROVER_INVITATION"
                : "INVALID_APPROVER_REFERENCE",
            severity: "ERROR",
            entityType: "STAGE_APPROVER",
            entityId: assignment.id,
            path: `stages.${String(stage.position - 1)}.approvers.${String(assignment.displayOrder - 1)}`,
            message: "Approver reference is unavailable for publication.",
          });
        if (assignment.assignmentType === "DEPARTMENT_ROLE") {
          const found = await this.database
            .select({ id: departments.id })
            .from(departments)
            .where(
              and(
                eq(departments.organizationId, organizationId),
                eq(departments.id, assignment.departmentId),
                eq(departments.status, "ACTIVE"),
              ),
            );
          if (found.length === 0)
            issues.push({
              code: "INVALID_DEPARTMENT_REFERENCE",
              severity: "ERROR",
              entityType: "STAGE_APPROVER",
              entityId: assignment.id,
              path: `stages.${String(stage.position - 1)}.approvers.${String(assignment.displayOrder - 1)}`,
              message: "Department reference is unavailable for publication.",
            });
        }
      }
    return issues;
  }

  public publish(
    input: Parameters<WorkflowRepository["publish"]>[0],
  ): Promise<"PUBLISHED" | "NOT_FOUND" | "CONFLICT" | "INVALID"> {
    return this.database.transaction(async (transaction) => {
      const [version] = await transaction
        .update(workflowVersions)
        .set({
          status: "PUBLISHED",
          publishedByMembershipId: input.membershipId,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowVersions.organizationId, input.organizationId),
            eq(workflowVersions.workflowId, input.workflowId),
            eq(workflowVersions.id, input.versionId),
            eq(workflowVersions.status, "DRAFT"),
            eq(workflowVersions.revision, input.expectedRevision),
          ),
        )
        .returning({ id: workflowVersions.id });
      if (!version) return "CONFLICT";
      await transaction
        .update(workflows)
        .set({
          currentPublishedVersionId: input.versionId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflows.organizationId, input.organizationId),
            eq(workflows.id, input.workflowId),
          ),
        );
      return "PUBLISHED";
    });
  }
}

function toAssignment(row: typeof stageApprovers.$inferSelect) {
  const base = { id: row.id, displayOrder: row.displayOrder };
  switch (row.assignmentType) {
    case "MEMBERSHIP":
      return row.membershipId
        ? {
            ...base,
            assignmentType: "MEMBERSHIP" as const,
            membershipId: row.membershipId,
          }
        : {
            ...base,
            assignmentType: "MEMBERSHIP" as const,
            invitationId: required(row.invitationId),
          };
    case "ROLE":
      return {
        ...base,
        assignmentType: "ROLE" as const,
        roleId: required(row.roleId),
      };
    case "DEPARTMENT_ROLE":
      return {
        ...base,
        assignmentType: "DEPARTMENT_ROLE" as const,
        departmentId: required(row.departmentId),
        roleId: required(row.roleId),
      };
    case "REQUESTER_MANAGER":
      return { ...base, assignmentType: "REQUESTER_MANAGER" as const };
    case "FORM_FIELD_USER":
      return {
        ...base,
        assignmentType: "FORM_FIELD_USER" as const,
        formFieldId: required(row.formFieldId),
      };
  }
}

function required(value: string | null): string {
  if (!value) throw new Error("Stored assignment violates its reference shape");
  return value;
}
