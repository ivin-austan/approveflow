import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  approvalRounds,
  approvalTasks,
  approvedArtifacts,
  artifactDeliveries,
  auditEvents,
  businessCalendars,
  departments,
  documentTypes,
  membershipDepartments,
  outboxEvents,
  requests,
  runtimeStages,
  stageApprovers,
  workflowStages,
  workflowVersions,
  workflows,
} from "@approveflow/database";
import {
  createMembershipFactory,
  createOrganizationFactory,
  createTestDatabase,
  createUserFactory,
  resetTestDatabase,
} from "@approveflow/database/testing";
import { DrizzleApprovalRepository } from "./approval.repository.js";
import { DrizzleRequestRepository } from "../request/request.repository.js";

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration("DrizzleApprovalRepository concurrency", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase(database.db);
  });

  afterAll(async () => {
    await database.close();
  });

  it("serializes concurrent ANY and ALL decisions and preserves idempotency", async () => {
    const requesterUser = await createUserFactory(database.db);
    const approverUserA = await createUserFactory(database.db);
    const approverUserB = await createUserFactory(database.db);
    const organization = await createOrganizationFactory(database.db);
    const requester = await createMembershipFactory(database.db, {
      organizationId: organization.id,
      userId: requesterUser.id,
    });
    const approverA = await createMembershipFactory(database.db, {
      organizationId: organization.id,
      userId: approverUserA.id,
    });
    const approverB = await createMembershipFactory(database.db, {
      organizationId: organization.id,
      userId: approverUserB.id,
    });
    const [department] = await database.db
      .insert(departments)
      .values({ organizationId: organization.id, name: "Finance", code: "FIN" })
      .returning();
    const [calendar] = await database.db
      .insert(businessCalendars)
      .values({
        organizationId: organization.id,
        name: "Default",
        timezone: "UTC",
      })
      .returning();
    if (!department || !calendar) throw new Error("Configuration setup failed");
    await database.db.insert(membershipDepartments).values({
      organizationId: organization.id,
      membershipId: requester.id,
      departmentId: department.id,
      isDefault: true,
    });
    const [documentType] = await database.db
      .insert(documentTypes)
      .values({
        organizationId: organization.id,
        businessCalendarId: calendar.id,
        name: "Purchase request",
        code: "PR",
        numberFormat: "{YEAR}-{SEQUENCE}",
      })
      .returning();
    if (!documentType) throw new Error("Document type setup failed");
    const [workflow] = await database.db
      .insert(workflows)
      .values({
        organizationId: organization.id,
        documentTypeId: documentType.id,
        name: "Purchase approval",
        createdByMembershipId: requester.id,
      })
      .returning();
    if (!workflow) throw new Error("Workflow setup failed");
    const [version] = await database.db
      .insert(workflowVersions)
      .values({
        organizationId: organization.id,
        workflowId: workflow.id,
        versionNumber: 1,
        status: "PUBLISHED",
        businessCalendarId: calendar.id,
        approvedPdfFieldPolicy: { includeAllSubmittedFields: true },
        publishedByMembershipId: requester.id,
        publishedAt: new Date(),
      })
      .returning();
    if (!version) throw new Error("Version setup failed");
    const sourceStages = await database.db
      .insert(workflowStages)
      .values([
        {
          organizationId: organization.id,
          workflowVersionId: version.id,
          name: "Team approval",
          position: 1,
          completionPolicy: "ANY" as const,
        },
        {
          organizationId: organization.id,
          workflowVersionId: version.id,
          name: "Final approval",
          position: 2,
          completionPolicy: "ALL" as const,
        },
      ])
      .returning();
    const [sourceFirst, sourceSecond] = sourceStages;
    if (!sourceFirst || !sourceSecond) throw new Error("Stage setup failed");
    await database.db.insert(stageApprovers).values([
      {
        organizationId: organization.id,
        workflowStageId: sourceFirst.id,
        assignmentType: "MEMBERSHIP",
        membershipId: approverA.id,
        displayOrder: 1,
      },
      {
        organizationId: organization.id,
        workflowStageId: sourceFirst.id,
        assignmentType: "MEMBERSHIP",
        membershipId: approverB.id,
        displayOrder: 2,
      },
      {
        organizationId: organization.id,
        workflowStageId: sourceSecond.id,
        assignmentType: "MEMBERSHIP",
        membershipId: approverA.id,
        displayOrder: 1,
      },
    ]);
    const [request] = await database.db
      .insert(requests)
      .values({
        organizationId: organization.id,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        documentTypeId: documentType.id,
        requesterMembershipId: requester.id,
        originatingDepartmentId: department.id,
        requestNumber: "FIN-PR-2026-000001",
        title: "New equipment",
        status: "IN_REVIEW",
        submittedAt: new Date(),
      })
      .returning();
    if (!request) throw new Error("Request setup failed");
    const [round] = await database.db
      .insert(approvalRounds)
      .values({
        organizationId: organization.id,
        requestId: request.id,
        roundNumber: 1,
      })
      .returning();
    if (!round) throw new Error("Round setup failed");
    const stages = await database.db
      .insert(runtimeStages)
      .values([
        {
          organizationId: organization.id,
          requestId: request.id,
          approvalRoundId: round.id,
          sourceWorkflowStageId: sourceFirst.id,
          levelNumber: 1,
          name: "Team approval",
          completionPolicy: "ANY" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
        },
        {
          organizationId: organization.id,
          requestId: request.id,
          approvalRoundId: round.id,
          sourceWorkflowStageId: sourceSecond.id,
          levelNumber: 2,
          name: "Final approval",
          completionPolicy: "ALL" as const,
          isFinal: true,
        },
      ])
      .returning();
    const [firstStage, secondStage] = stages;
    if (!firstStage || !secondStage)
      throw new Error("Runtime stage setup failed");
    const tasks = await database.db
      .insert(approvalTasks)
      .values([
        {
          organizationId: organization.id,
          requestId: request.id,
          runtimeStageId: firstStage.id,
          assignedMembershipId: approverA.id,
          assigneeName: "Approver A",
          assigneeEmail: approverUserA.email,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
        },
        {
          organizationId: organization.id,
          requestId: request.id,
          runtimeStageId: firstStage.id,
          assignedMembershipId: approverB.id,
          assigneeName: "Approver B",
          assigneeEmail: approverUserB.email,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
        },
        {
          organizationId: organization.id,
          requestId: request.id,
          runtimeStageId: secondStage.id,
          assignedMembershipId: approverA.id,
          assigneeName: "Final approver",
          assigneeEmail: approverUserA.email,
        },
      ])
      .returning();
    const [taskA, taskB, finalTask] = tasks;
    if (!taskA || !taskB || !finalTask) throw new Error("Task setup failed");

    const repository = new DrizzleApprovalRepository(database.db);
    const decisionA = {
      organizationId: organization.id,
      membershipId: approverA.id,
      taskId: taskA.id,
      idempotencyKey: "decision-a",
      requestHash: "hash-a",
      expectedRequestRevision: 1,
      action: "APPROVE" as const,
      comment: null,
    };
    const decisionB = {
      organizationId: organization.id,
      membershipId: approverB.id,
      taskId: taskB.id,
      idempotencyKey: "decision-b",
      requestHash: "hash-b",
      expectedRequestRevision: 1,
      action: "APPROVE" as const,
      comment: null,
    };
    const results = await Promise.all([
      repository.decide(decisionA),
      repository.decide(decisionB),
    ]);

    expect(results).toContain("DECIDED");
    expect(results).toContain("STALE");
    const storedTasks = await database.db
      .select({ id: approvalTasks.id, status: approvalTasks.status })
      .from(approvalTasks)
      .where(inArray(approvalTasks.id, [taskA.id, taskB.id]));
    expect(
      storedTasks.filter((task) => task.status === "APPROVED"),
    ).toHaveLength(1);
    expect(
      storedTasks.filter((task) => task.status === "SKIPPED"),
    ).toHaveLength(1);
    const storedStages = await database.db
      .select({ status: runtimeStages.status })
      .from(runtimeStages)
      .where(inArray(runtimeStages.id, [firstStage.id, secondStage.id]));
    expect(
      storedStages.filter((stage) => stage.status === "COMPLETED"),
    ).toHaveLength(1);
    expect(
      storedStages.filter((stage) => stage.status === "ACTIVE"),
    ).toHaveLength(1);

    const successfulDecision = results[0] === "DECIDED" ? decisionA : decisionB;
    await expect(repository.decide(successfulDecision)).resolves.toBe("REPLAY");
    await expect(
      repository.decide({
        ...successfulDecision,
        requestHash: "different-payload-hash",
      }),
    ).resolves.toBe("IDEMPOTENCY_MISMATCH");
    expect(await database.db.select().from(auditEvents)).toHaveLength(1);
    expect(await database.db.select().from(outboxEvents)).toHaveLength(1);

    await expect(
      repository.decide({
        organizationId: organization.id,
        membershipId: approverA.id,
        taskId: finalTask.id,
        idempotencyKey: "return-final-stage",
        requestHash: "return-final-stage-hash",
        expectedRequestRevision: 1,
        action: "RETURN",
        comment: "Please revise the supporting details.",
      }),
    ).resolves.toBe("DECIDED");
    const [returnedRequest] = await database.db
      .select({ status: requests.status, revision: requests.revision })
      .from(requests)
      .where(eq(requests.id, request.id));
    expect(returnedRequest).toEqual({ status: "RETURNED", revision: 2 });
    const [completedRound] = await database.db
      .select({ status: approvalRounds.status })
      .from(approvalRounds)
      .where(eq(approvalRounds.id, round.id));
    expect(completedRound?.status).toBe("COMPLETED");
    expect(await database.db.select().from(auditEvents)).toHaveLength(2);
    expect(await database.db.select().from(outboxEvents)).toHaveLength(2);

    const requestRepository = new DrizzleRequestRepository(database.db);
    const resubmission = await requestRepository.submit({
      organizationId: organization.id,
      membershipId: requester.id,
      requestId: request.id,
      idempotencyKey: "resubmit-returned-request",
      requestHash: "resubmit-returned-request-hash",
      expectedRevision: 2,
      originatingDepartmentId: department.id,
    });
    expect(resubmission.outcome).toBe("SUBMITTED");
    if (resubmission.outcome !== "SUBMITTED")
      throw new Error("Resubmission failed");
    expect(resubmission.request).toMatchObject({
      requestNumber: request.requestNumber,
      status: "IN_REVIEW",
      revision: 3,
      currentStage: "Team approval",
    });
    const storedRounds = await database.db
      .select({
        id: approvalRounds.id,
        roundNumber: approvalRounds.roundNumber,
        status: approvalRounds.status,
      })
      .from(approvalRounds)
      .where(eq(approvalRounds.requestId, request.id));
    expect(storedRounds).toHaveLength(2);
    expect(storedRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roundNumber: 1, status: "SUPERSEDED" }),
        expect.objectContaining({ roundNumber: 2, status: "ACTIVE" }),
      ]),
    );
    const secondRound = storedRounds.find((item) => item.roundNumber === 2);
    if (!secondRound) throw new Error("Second round was not created");
    const resubmittedStages = await database.db
      .select({
        id: runtimeStages.id,
        level: runtimeStages.levelNumber,
        status: runtimeStages.status,
      })
      .from(runtimeStages)
      .where(eq(runtimeStages.approvalRoundId, secondRound.id));
    expect(resubmittedStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 1, status: "ACTIVE" }),
        expect.objectContaining({ level: 2, status: "PENDING" }),
      ]),
    );
    expect(await database.db.select().from(auditEvents)).toHaveLength(3);
    expect(await database.db.select().from(outboxEvents)).toHaveLength(3);

    const resubmittedFirstStage = resubmittedStages.find(
      (stage) => stage.level === 1,
    );
    const resubmittedFinalStage = resubmittedStages.find(
      (stage) => stage.level === 2,
    );
    if (!resubmittedFirstStage || !resubmittedFinalStage)
      throw new Error("Resubmitted stages are missing");
    const resubmittedFirstTasks = await database.db
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.runtimeStageId, resubmittedFirstStage.id));
    const resubmittedFirstTask = resubmittedFirstTasks.find(
      (task) => task.assignedMembershipId === approverA.id,
    );
    if (!resubmittedFirstTask)
      throw new Error("Resubmitted first-stage task is missing");
    await expect(
      repository.decide({
        organizationId: organization.id,
        membershipId: approverA.id,
        taskId: resubmittedFirstTask.id,
        idempotencyKey: "resubmitted-first-approval",
        requestHash: "resubmitted-first-approval-hash",
        expectedRequestRevision: 3,
        action: "APPROVE",
        comment: null,
      }),
    ).resolves.toBe("DECIDED");
    const [resubmittedFinalTask] = await database.db
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.runtimeStageId, resubmittedFinalStage.id));
    if (!resubmittedFinalTask)
      throw new Error("Resubmitted final task is missing");
    const finalDecision = {
      organizationId: organization.id,
      membershipId: approverA.id,
      taskId: resubmittedFinalTask.id,
      idempotencyKey: "resubmitted-final-approval",
      requestHash: "resubmitted-final-approval-hash",
      expectedRequestRevision: 3,
      action: "APPROVE" as const,
      comment: null,
    };
    await expect(repository.decide(finalDecision)).resolves.toBe("DECIDED");
    await expect(repository.decide(finalDecision)).resolves.toBe("REPLAY");
    const [approvedRequest] = await database.db
      .select({ status: requests.status, revision: requests.revision })
      .from(requests)
      .where(eq(requests.id, request.id));
    expect(approvedRequest).toEqual({ status: "APPROVED", revision: 4 });
    const artifacts = await database.db
      .select()
      .from(approvedArtifacts)
      .where(eq(approvedArtifacts.requestId, request.id));
    expect(artifacts).toHaveLength(1);
    const [artifact] = artifacts;
    if (!artifact) throw new Error("Approved artifact is missing");
    expect(artifact.approvalRoundId).toBe(secondRound.id);
    const deliveries = await database.db
      .select()
      .from(artifactDeliveries)
      .where(eq(artifactDeliveries.artifactId, artifact.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      recipientMembershipId: requester.id,
      recipientEmail: requesterUser.email,
      recipientKind: "INITIATOR",
      status: "PERMANENTLY_FAILED",
      lastErrorCode: "RECIPIENT_INELIGIBLE",
    });
    expect(await database.db.select().from(auditEvents)).toHaveLength(5);
    const outboxAfterApproval = await database.db.select().from(outboxEvents);
    expect(outboxAfterApproval).toHaveLength(6);
    expect(
      outboxAfterApproval.filter(
        (event) => event.eventType === "APPROVED_ARTIFACT_GENERATION_REQUESTED",
      ),
    ).toHaveLength(1);

    const [allRequest] = await database.db
      .insert(requests)
      .values({
        organizationId: organization.id,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        documentTypeId: documentType.id,
        requesterMembershipId: requester.id,
        originatingDepartmentId: department.id,
        requestNumber: "FIN-PR-2026-000002",
        title: "All-approver equipment",
        status: "IN_REVIEW",
        submittedAt: new Date(),
      })
      .returning();
    if (!allRequest) throw new Error("ALL request setup failed");
    const [allRound] = await database.db
      .insert(approvalRounds)
      .values({
        organizationId: organization.id,
        requestId: allRequest.id,
        roundNumber: 1,
      })
      .returning();
    if (!allRound) throw new Error("ALL round setup failed");
    const allStages = await database.db
      .insert(runtimeStages)
      .values([
        {
          organizationId: organization.id,
          requestId: allRequest.id,
          approvalRoundId: allRound.id,
          sourceWorkflowStageId: sourceFirst.id,
          levelNumber: 1,
          name: "All approvers",
          completionPolicy: "ALL" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
        },
        {
          organizationId: organization.id,
          requestId: allRequest.id,
          approvalRoundId: allRound.id,
          sourceWorkflowStageId: sourceSecond.id,
          levelNumber: 2,
          name: "Final approval",
          completionPolicy: "ALL" as const,
          isFinal: true,
        },
      ])
      .returning();
    const [allFirstStage, allSecondStage] = allStages;
    if (!allFirstStage || !allSecondStage)
      throw new Error("ALL runtime stage setup failed");
    const allTasks = await database.db
      .insert(approvalTasks)
      .values([
        {
          organizationId: organization.id,
          requestId: allRequest.id,
          runtimeStageId: allFirstStage.id,
          assignedMembershipId: approverA.id,
          assigneeName: "Approver A",
          assigneeEmail: approverUserA.email,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
        },
        {
          organizationId: organization.id,
          requestId: allRequest.id,
          runtimeStageId: allFirstStage.id,
          assignedMembershipId: approverB.id,
          assigneeName: "Approver B",
          assigneeEmail: approverUserB.email,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
        },
        {
          organizationId: organization.id,
          requestId: allRequest.id,
          runtimeStageId: allSecondStage.id,
          assignedMembershipId: approverA.id,
          assigneeName: "Final approver",
          assigneeEmail: approverUserA.email,
        },
      ])
      .returning();
    const [allTaskA, allTaskB, allFinalTask] = allTasks;
    if (!allTaskA || !allTaskB || !allFinalTask)
      throw new Error("ALL task setup failed");

    const allResults = await Promise.all([
      repository.decide({
        organizationId: organization.id,
        membershipId: approverA.id,
        taskId: allTaskA.id,
        idempotencyKey: "all-decision-a",
        requestHash: "all-hash-a",
        expectedRequestRevision: 1,
        action: "APPROVE",
        comment: null,
      }),
      repository.decide({
        organizationId: organization.id,
        membershipId: approverB.id,
        taskId: allTaskB.id,
        idempotencyKey: "all-decision-b",
        requestHash: "all-hash-b",
        expectedRequestRevision: 1,
        action: "APPROVE",
        comment: null,
      }),
    ]);

    expect(allResults).toEqual(["DECIDED", "DECIDED"]);
    const storedAllTasks = await database.db
      .select({ status: approvalTasks.status })
      .from(approvalTasks)
      .where(inArray(approvalTasks.id, [allTaskA.id, allTaskB.id]));
    expect(
      storedAllTasks.filter((task) => task.status === "APPROVED"),
    ).toHaveLength(2);
    const storedAllStages = await database.db
      .select({ status: runtimeStages.status })
      .from(runtimeStages)
      .where(inArray(runtimeStages.id, [allFirstStage.id, allSecondStage.id]));
    expect(
      storedAllStages.filter((stage) => stage.status === "COMPLETED"),
    ).toHaveLength(1);
    expect(
      storedAllStages.filter((stage) => stage.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(await database.db.select().from(auditEvents)).toHaveLength(7);
    expect(await database.db.select().from(outboxEvents)).toHaveLength(8);

    await expect(
      repository.decide({
        organizationId: organization.id,
        membershipId: approverA.id,
        taskId: allFinalTask.id,
        idempotencyKey: "reject-final-stage",
        requestHash: "reject-final-stage-hash",
        expectedRequestRevision: 1,
        action: "REJECT",
        comment: "The request exceeds the approved budget.",
      }),
    ).resolves.toBe("DECIDED");
    const [rejectedRequest] = await database.db
      .select({ status: requests.status, revision: requests.revision })
      .from(requests)
      .where(eq(requests.id, allRequest.id));
    expect(rejectedRequest).toEqual({ status: "REJECTED", revision: 2 });
    const [rejectedRound] = await database.db
      .select({ status: approvalRounds.status })
      .from(approvalRounds)
      .where(eq(approvalRounds.id, allRound.id));
    expect(rejectedRound?.status).toBe("COMPLETED");
    expect(await database.db.select().from(auditEvents)).toHaveLength(8);
    expect(await database.db.select().from(outboxEvents)).toHaveLength(9);
  });
});
