import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  businessCalendars,
  documentTypes,
  requests,
  workflowVersions,
  workflows,
} from "./schema.js";
import {
  createMembershipFactory,
  createOrganizationFactory,
  createTestDatabase,
  createUserFactory,
  resetTestDatabase,
} from "./testing.js";

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration("PostgreSQL tenant isolation", () => {
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

  it("rejects a request that references another tenant's workflow", async () => {
    const userA = await createUserFactory(database.db);
    const userB = await createUserFactory(database.db);
    const organizationA = await createOrganizationFactory(database.db);
    const organizationB = await createOrganizationFactory(database.db);
    const membershipA = await createMembershipFactory(database.db, {
      organizationId: organizationA.id,
      userId: userA.id,
    });
    const membershipB = await createMembershipFactory(database.db, {
      organizationId: organizationB.id,
      userId: userB.id,
    });

    const [calendarA] = await database.db
      .insert(businessCalendars)
      .values({
        organizationId: organizationA.id,
        name: "Tenant A calendar",
        timezone: "UTC",
      })
      .returning();
    const [calendarB] = await database.db
      .insert(businessCalendars)
      .values({
        organizationId: organizationB.id,
        name: "Tenant B calendar",
        timezone: "UTC",
      })
      .returning();
    if (!calendarA || !calendarB) throw new Error("Calendar setup failed");

    const [documentTypeA] = await database.db
      .insert(documentTypes)
      .values({
        organizationId: organizationA.id,
        businessCalendarId: calendarA.id,
        name: "Tenant A document",
        code: "A",
        numberFormat: "{YEAR}-{SEQUENCE}",
      })
      .returning();
    const [documentTypeB] = await database.db
      .insert(documentTypes)
      .values({
        organizationId: organizationB.id,
        businessCalendarId: calendarB.id,
        name: "Tenant B document",
        code: "B",
        numberFormat: "{YEAR}-{SEQUENCE}",
      })
      .returning();
    if (!documentTypeA || !documentTypeB)
      throw new Error("Document type setup failed");

    const [workflowA] = await database.db
      .insert(workflows)
      .values({
        organizationId: organizationA.id,
        documentTypeId: documentTypeA.id,
        name: "Tenant A workflow",
        createdByMembershipId: membershipA.id,
      })
      .returning();
    const [workflowB] = await database.db
      .insert(workflows)
      .values({
        organizationId: organizationB.id,
        documentTypeId: documentTypeB.id,
        name: "Tenant B workflow",
        createdByMembershipId: membershipB.id,
      })
      .returning();
    if (!workflowA || !workflowB) throw new Error("Workflow setup failed");

    const [versionA] = await database.db
      .insert(workflowVersions)
      .values({
        organizationId: organizationA.id,
        workflowId: workflowA.id,
        versionNumber: 1,
        businessCalendarId: calendarA.id,
        approvedPdfFieldPolicy: { includeAllSubmittedFields: true },
      })
      .returning();
    if (!versionA) throw new Error("Workflow version setup failed");

    await expect(
      database.db.insert(requests).values({
        organizationId: organizationA.id,
        workflowId: workflowB.id,
        workflowVersionId: versionA.id,
        documentTypeId: documentTypeA.id,
        requesterMembershipId: membershipA.id,
        title: "Cross-tenant request",
      }),
    ).rejects.toThrow();

    await expect(
      database.db.insert(requests).values({
        organizationId: organizationA.id,
        workflowId: workflowA.id,
        workflowVersionId: versionA.id,
        documentTypeId: documentTypeA.id,
        requesterMembershipId: membershipA.id,
        title: "Same-tenant request",
      }),
    ).resolves.toBeDefined();
  });
});
