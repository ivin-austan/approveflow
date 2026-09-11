import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  businessCalendars,
  formFields,
  formSections,
  fieldOptions,
  fieldConditions,
  memberships,
  membershipDepartments,
  membershipRoles,
  roles,
  departments,
  documentTypes,
  schema as databaseSchema,
  stageApprovers,
  stageReminderRules,
  stageEscalationRules,
  workflowStages,
  workflowVersions,
  workflows,
  users,
} from "@approveflow/database";
import { conditionSchema } from "./condition.js";
import {
  escalationRuleSchema,
  reminderRuleSchema,
} from "./workflow.schemas.js";
import type {
  StoredDraft,
  ValidationIssue,
  WorkflowRepository,
} from "./workflow.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleWorkflowRepository implements WorkflowRepository {
  public constructor(private readonly database: Database) {}

  public list(organizationId: string) {
    return this.database
      .select({
        id: workflows.id,
        documentTypeId: workflows.documentTypeId,
        name: workflows.name,
        description: workflows.description,
        status: workflows.status,
        currentPublishedVersionId: workflows.currentPublishedVersionId,
      })
      .from(workflows)
      .where(eq(workflows.organizationId, organizationId))
      .orderBy(asc(workflows.name));
  }

  public create(
    input: Parameters<WorkflowRepository["create"]>[0],
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [documentType] = await transaction
        .select()
        .from(documentTypes)
        .where(
          and(
            eq(documentTypes.organizationId, input.organizationId),
            eq(documentTypes.id, input.documentTypeId),
            eq(documentTypes.status, "ACTIVE"),
          ),
        );
      if (!documentType) return false;
      await transaction.insert(workflows).values({
        id: input.id,
        organizationId: input.organizationId,
        documentTypeId: input.documentTypeId,
        name: input.name,
        description: input.description,
        createdByMembershipId: input.membershipId,
      });
      await transaction.insert(workflowVersions).values({
        id: input.versionId,
        organizationId: input.organizationId,
        workflowId: input.id,
        versionNumber: 1,
        businessCalendarId: documentType.businessCalendarId,
        approvedPdfFieldPolicy: documentType.approvedPdfFieldPolicy,
        automaticApprovalEnabled: documentType.automaticApprovalEnabled,
        automaticApprovalDuration: documentType.automaticApprovalDuration,
        automaticApprovalDurationUnit:
          documentType.automaticApprovalDurationUnit,
      });
      return true;
    });
  }

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
    const sections = await this.database
      .select()
      .from(formSections)
      .where(
        and(
          eq(formSections.organizationId, organizationId),
          eq(formSections.workflowVersionId, versionId),
        ),
      )
      .orderBy(asc(formSections.position));
    const fields = await this.database
      .select()
      .from(formFields)
      .where(
        and(
          eq(formFields.organizationId, organizationId),
          eq(formFields.workflowVersionId, versionId),
        ),
      )
      .orderBy(asc(formFields.position));
    const fieldIds = fields.map(({ id }) => id);
    const options =
      fieldIds.length === 0
        ? []
        : await this.database
            .select()
            .from(fieldOptions)
            .where(
              and(
                eq(fieldOptions.organizationId, organizationId),
                inArray(fieldOptions.formFieldId, fieldIds),
              ),
            )
            .orderBy(asc(fieldOptions.position));
    const conditions = await this.database
      .select()
      .from(fieldConditions)
      .where(
        and(
          eq(fieldConditions.organizationId, organizationId),
          eq(fieldConditions.workflowVersionId, versionId),
        ),
      );
    const reminders =
      stageIds.length === 0
        ? []
        : await this.database
            .select()
            .from(stageReminderRules)
            .where(
              and(
                eq(stageReminderRules.organizationId, organizationId),
                inArray(stageReminderRules.workflowStageId, stageIds),
              ),
            )
            .orderBy(asc(stageReminderRules.sequence));
    const escalations =
      stageIds.length === 0
        ? []
        : await this.database
            .select()
            .from(stageEscalationRules)
            .where(
              and(
                eq(stageEscalationRules.organizationId, organizationId),
                inArray(stageEscalationRules.workflowStageId, stageIds),
              ),
            )
            .orderBy(asc(stageEscalationRules.sequence));
    return {
      workflowId,
      versionId,
      revision: version.revision,
      expectedRevision: version.revision,
      automaticApprovalEnabled: version.automaticApprovalEnabled,
      formSections: sections.map((section) => ({
        id: section.id,
        stableKey: section.stableKey,
        name: section.name,
        description: section.description,
        position: section.position,
        fields: fields
          .filter((field) => field.formSectionId === section.id)
          .map((field) => ({
            id: field.id,
            stableKey: field.stableKey,
            type: field.type,
            label: field.label,
            description: field.description,
            required: field.isRequired,
            position: field.position,
            config: field.config,
            options: options
              .filter((option) => option.formFieldId === field.id)
              .map((option) => ({
                id: option.id,
                stableValue: option.stableValue,
                label: option.label,
                position: option.position,
              })),
          })),
      })),
      fieldConditions: conditions.map((item) => ({
        id: item.id,
        targetFormFieldId: item.targetFormFieldId,
        effect: item.effect,
        condition: conditionSchema.parse(item.condition),
      })),
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
        businessCalendarId: stage.businessCalendarId,
        activationCondition: stage.activationCondition
          ? conditionSchema.parse(stage.activationCondition)
          : null,
        approvers: approvers
          .filter(({ workflowStageId }) => workflowStageId === stage.id)
          .map(toAssignment),
        reminders: reminders
          .filter((rule) => rule.workflowStageId === stage.id)
          .map((rule) =>
            reminderRuleSchema.parse({
              id: rule.id,
              sequence: rule.sequence,
              offset: { value: rule.offsetValue, unit: rule.offsetUnit },
              offsetAnchor: rule.offsetAnchor,
              recipientPolicy: rule.recipientPolicy,
            }),
          ),
        escalations: escalations
          .filter((rule) => rule.workflowStageId === stage.id)
          .map((rule) =>
            escalationRuleSchema.parse({
              id: rule.id,
              sequence: rule.sequence,
              offset: { value: rule.offsetValue, unit: rule.offsetUnit },
              offsetAnchor: rule.offsetAnchor,
              action: rule.action,
              ...(rule.recipientPolicy
                ? { recipientPolicy: rule.recipientPolicy }
                : {}),
            }),
          ),
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
      const existingStages = await transaction
        .select({ id: workflowStages.id })
        .from(workflowStages)
        .where(
          and(
            eq(workflowStages.organizationId, input.organizationId),
            eq(workflowStages.workflowVersionId, input.versionId),
          ),
        );
      const existingStageIds = existingStages.map(({ id }) => id);
      if (existingStageIds.length > 0) {
        await transaction
          .delete(stageReminderRules)
          .where(
            and(
              eq(stageReminderRules.organizationId, input.organizationId),
              inArray(stageReminderRules.workflowStageId, existingStageIds),
            ),
          );
        await transaction
          .delete(stageEscalationRules)
          .where(
            and(
              eq(stageEscalationRules.organizationId, input.organizationId),
              inArray(stageEscalationRules.workflowStageId, existingStageIds),
            ),
          );
        await transaction
          .delete(stageApprovers)
          .where(
            and(
              eq(stageApprovers.organizationId, input.organizationId),
              inArray(stageApprovers.workflowStageId, existingStageIds),
            ),
          );
      }
      await transaction
        .delete(workflowStages)
        .where(
          and(
            eq(workflowStages.organizationId, input.organizationId),
            eq(workflowStages.workflowVersionId, input.versionId),
          ),
        );
      const existingFields = await transaction
        .select({ id: formFields.id })
        .from(formFields)
        .where(
          and(
            eq(formFields.organizationId, input.organizationId),
            eq(formFields.workflowVersionId, input.versionId),
          ),
        );
      const existingFieldIds = existingFields.map(({ id }) => id);
      await transaction
        .delete(fieldConditions)
        .where(
          and(
            eq(fieldConditions.organizationId, input.organizationId),
            eq(fieldConditions.workflowVersionId, input.versionId),
          ),
        );
      if (existingFieldIds.length > 0)
        await transaction
          .delete(fieldOptions)
          .where(
            and(
              eq(fieldOptions.organizationId, input.organizationId),
              inArray(fieldOptions.formFieldId, existingFieldIds),
            ),
          );
      await transaction
        .delete(formFields)
        .where(
          and(
            eq(formFields.organizationId, input.organizationId),
            eq(formFields.workflowVersionId, input.versionId),
          ),
        );
      await transaction
        .delete(formSections)
        .where(
          and(
            eq(formSections.organizationId, input.organizationId),
            eq(formSections.workflowVersionId, input.versionId),
          ),
        );
      for (const section of input.definition.formSections) {
        await transaction.insert(formSections).values({
          id: section.id,
          organizationId: input.organizationId,
          workflowVersionId: input.versionId,
          stableKey: section.stableKey,
          name: section.name,
          description: section.description,
          position: section.position,
        });
        for (const field of section.fields) {
          await transaction.insert(formFields).values({
            id: field.id,
            organizationId: input.organizationId,
            workflowVersionId: input.versionId,
            formSectionId: section.id,
            stableKey: field.stableKey,
            type: field.type,
            label: field.label,
            description: field.description,
            isRequired: field.required,
            position: field.position,
            config: field.config,
          });
          if (field.options.length > 0)
            await transaction.insert(fieldOptions).values(
              field.options.map((option) => ({
                id: option.id,
                organizationId: input.organizationId,
                formFieldId: field.id,
                stableValue: option.stableValue,
                label: option.label,
                position: option.position,
              })),
            );
        }
      }
      if (input.definition.fieldConditions.length > 0)
        await transaction.insert(fieldConditions).values(
          input.definition.fieldConditions.map((item) => ({
            id: item.id,
            organizationId: input.organizationId,
            workflowVersionId: input.versionId,
            targetFormFieldId: item.targetFormFieldId,
            effect: item.effect,
            condition: item.condition,
          })),
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
          businessCalendarId: stage.businessCalendarId,
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
        if (stage.reminders.length > 0)
          await transaction.insert(stageReminderRules).values(
            stage.reminders.map((rule) => ({
              id: rule.id,
              organizationId: input.organizationId,
              workflowStageId: stage.id,
              sequence: rule.sequence,
              offsetValue: rule.offset.value,
              offsetUnit: rule.offset.unit,
              offsetAnchor: rule.offsetAnchor,
              recipientPolicy: rule.recipientPolicy,
            })),
          );
        if (stage.escalations.length > 0)
          await transaction.insert(stageEscalationRules).values(
            stage.escalations.map((rule) => ({
              id: rule.id,
              organizationId: input.organizationId,
              workflowStageId: stage.id,
              sequence: rule.sequence,
              offsetValue: rule.offset.value,
              offsetUnit: rule.offset.unit,
              offsetAnchor: rule.offsetAnchor,
              action: rule.action,
              recipientPolicy:
                rule.action === "NOTIFY" ? rule.recipientPolicy : null,
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
    for (const stage of draft.stages) {
      if (stage.businessCalendarId) {
        const calendar = await this.database
          .select({ id: businessCalendars.id })
          .from(businessCalendars)
          .where(
            and(
              eq(businessCalendars.organizationId, organizationId),
              eq(businessCalendars.id, stage.businessCalendarId),
            ),
          );
        if (calendar.length === 0)
          issues.push({
            code: "INVALID_BUSINESS_CALENDAR_REFERENCE",
            severity: "ERROR",
            entityType: "STAGE",
            entityId: stage.id,
            path: `stages.${String(stage.position - 1)}.businessCalendarId`,
            message:
              "Business calendar reference is unavailable for publication.",
          });
      }
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
    }
    return issues;
  }

  public async previewAssignments(
    organizationId: string,
    draft: StoredDraft,
    answers: Readonly<Record<string, unknown>>,
  ) {
    const result: {
      assignmentId: string;
      status: "RESOLVED" | "UNRESOLVED";
      memberships: { id: string; name: string; email: string }[];
    }[] = [];
    for (const assignment of draft.stages.flatMap((stage) => stage.approvers)) {
      let requestedIds: string[] | null = null;
      if (assignment.assignmentType === "MEMBERSHIP")
        requestedIds = assignment.membershipId ? [assignment.membershipId] : [];
      else if (assignment.assignmentType === "FORM_FIELD_USER")
        requestedIds =
          typeof answers[assignment.formFieldId] === "string"
            ? [answers[assignment.formFieldId] as string]
            : [];
      if (assignment.assignmentType === "REQUESTER_MANAGER") {
        result.push({
          assignmentId: assignment.id,
          status: "UNRESOLVED",
          memberships: [],
        });
        continue;
      }
      const base = this.database
        .select({
          id: memberships.id,
          name: users.fullName,
          email: users.email,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId));
      let rows: { id: string; name: string; email: string }[];
      if (requestedIds)
        rows =
          requestedIds.length === 0
            ? []
            : await base.where(
                and(
                  eq(memberships.organizationId, organizationId),
                  eq(memberships.status, "ACTIVE"),
                  inArray(memberships.id, requestedIds),
                ),
              );
      else if (assignment.assignmentType === "ROLE")
        rows = await base
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
      else if (assignment.assignmentType === "DEPARTMENT_ROLE")
        rows = await base
          .innerJoin(
            membershipRoles,
            and(
              eq(membershipRoles.organizationId, memberships.organizationId),
              eq(membershipRoles.membershipId, memberships.id),
            ),
          )
          .innerJoin(
            membershipDepartments,
            and(
              eq(
                membershipDepartments.organizationId,
                memberships.organizationId,
              ),
              eq(membershipDepartments.membershipId, memberships.id),
            ),
          )
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.status, "ACTIVE"),
              eq(membershipRoles.roleId, assignment.roleId),
              eq(membershipDepartments.departmentId, assignment.departmentId),
            ),
          );
      else rows = [];
      const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
      result.push({
        assignmentId: assignment.id,
        status: unique.length > 0 ? "RESOLVED" : "UNRESOLVED",
        memberships: unique,
      });
    }
    return result;
  }

  public publish(
    input: Parameters<WorkflowRepository["publish"]>[0],
  ): Promise<"PUBLISHED" | "NOT_FOUND" | "CONFLICT" | "INVALID"> {
    return this.database.transaction(
      async (transaction) => {
        const [locked] = await transaction
          .select({
            id: workflowVersions.id,
            revision: workflowVersions.revision,
            automaticApprovalEnabled: workflowVersions.automaticApprovalEnabled,
            allowNoStageAutomaticApproval:
              workflowVersions.allowNoStageAutomaticApproval,
          })
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.organizationId, input.organizationId),
              eq(workflowVersions.workflowId, input.workflowId),
              eq(workflowVersions.id, input.versionId),
              eq(workflowVersions.status, "DRAFT"),
            ),
          )
          .for("update");
        if (!locked) return "NOT_FOUND";
        if (locked.revision !== input.expectedRevision) return "CONFLICT";
        const validation = await transaction.execute(sql<{ invalid: boolean }>`
        select exists (
          select 1 from workflow_stages s
          left join stage_approvers a on a.workflow_stage_id = s.id and a.organization_id = s.organization_id
          left join memberships m on a.assignment_type = 'MEMBERSHIP' and a.membership_id = m.id and m.organization_id = a.organization_id and m.status = 'ACTIVE'
          left join roles r on a.assignment_type in ('ROLE', 'DEPARTMENT_ROLE') and a.role_id = r.id and r.organization_id = a.organization_id and r.status = 'ACTIVE'
          left join departments d on a.assignment_type = 'DEPARTMENT_ROLE' and a.department_id = d.id and d.organization_id = a.organization_id and d.status = 'ACTIVE'
          left join form_fields f on a.assignment_type = 'FORM_FIELD_USER' and a.form_field_id = f.id and f.organization_id = a.organization_id and f.workflow_version_id = s.workflow_version_id and f.type = 'MEMBER_SELECTOR'
          where s.organization_id = ${input.organizationId} and s.workflow_version_id = ${input.versionId}
            and (a.id is null or a.invitation_id is not null
              or (a.assignment_type = 'MEMBERSHIP' and m.id is null)
              or (a.assignment_type in ('ROLE', 'DEPARTMENT_ROLE') and r.id is null)
              or (a.assignment_type = 'DEPARTMENT_ROLE' and d.id is null)
              or (a.assignment_type = 'FORM_FIELD_USER' and f.id is null))
        ) as invalid
      `);
        const [stageCount] = await transaction
          .select({ count: sql<number>`count(*)::int` })
          .from(workflowStages)
          .where(
            and(
              eq(workflowStages.organizationId, input.organizationId),
              eq(workflowStages.workflowVersionId, input.versionId),
            ),
          );
        if (
          validation.rows[0]?.invalid ||
          ((stageCount?.count ?? 0) === 0 &&
            !(
              locked.allowNoStageAutomaticApproval &&
              locked.automaticApprovalEnabled
            ))
        )
          return "INVALID";
        await transaction
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
              eq(workflowVersions.id, input.versionId),
              eq(workflowVersions.status, "DRAFT"),
              eq(workflowVersions.revision, input.expectedRevision),
            ),
          );
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
      },
      { isolationLevel: "serializable" },
    );
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
