import { describe, expect, it, vi } from "vitest";
import {
  RequestInputError,
  RequestService,
  type RequestForm,
  type RequestRepository,
} from "./request.service.js";

const workflowId = "00000000-0000-4000-8000-000000000010";
const versionId = "00000000-0000-4000-8000-000000000011";
const fieldId = "00000000-0000-4000-8000-000000000012";
const form: RequestForm = {
  workflowId,
  workflowVersionId: versionId,
  workflowName: "Purchase",
  sections: [
    {
      id: "00000000-0000-4000-8000-000000000013",
      name: "Request",
      description: null,
      fields: [
        {
          id: fieldId,
          type: "NUMBER",
          label: "Amount",
          required: true,
          optionValues: [],
        },
      ],
    },
  ],
  conditions: [],
};

function repository() {
  const createDraft = vi.fn<RequestRepository["createDraft"]>(() =>
    Promise.resolve(),
  );
  const submit = vi.fn<RequestRepository["submit"]>(() =>
    Promise.resolve({
      outcome: "SUBMITTED" as const,
      request: {
        id: "00000000-0000-4000-8000-000000000014",
        requestNumber: "PUR-FIN-2026-000001",
        title: "Laptop",
        status: "IN_REVIEW" as const,
        revision: 2,
        currentStage: "Manager",
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  );
  const repo: RequestRepository = {
    list: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.resolve(null)),
    getForm: vi.fn(() => Promise.resolve(form)),
    createDraft,
    updateDraft: vi.fn(() => Promise.resolve("UPDATED" as const)),
    getDraftForSubmission: vi.fn(() =>
      Promise.resolve({
        revision: 1,
        status: "DRAFT" as const,
        originatingDepartmentId: null,
        form,
        answers: { [fieldId]: 100 },
      }),
    ),
    submit,
  };
  return { repo, createDraft, submit };
}

describe("RequestService", () => {
  it("validates answers before persisting a draft", async () => {
    const { repo, createDraft } = repository();
    const service = new RequestService(repo);
    await expect(
      service.createDraft("org", "member", {
        workflowId,
        title: "Laptop",
        answers: { [fieldId]: "wrong" },
      }),
    ).rejects.toBeInstanceOf(RequestInputError);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("passes a stable request hash into idempotent submission", async () => {
    const { repo, submit } = repository();
    const service = new RequestService(repo);
    await service.submit("org", "member", "request", "key-1", {
      expectedRevision: 1,
      originatingDepartmentId: "00000000-0000-4000-8000-000000000020",
    });
    const call = submit.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Submission repository was not called");
    expect(call[0].idempotencyKey).toBe("key-1");
    expect(call[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("resubmits a returned request with its immutable originating department", async () => {
    const { repo, submit } = repository();
    const departmentId = "00000000-0000-4000-8000-000000000020";
    repo.getDraftForSubmission = vi.fn(() =>
      Promise.resolve({
        revision: 4,
        status: "RETURNED" as const,
        originatingDepartmentId: departmentId,
        form,
        answers: { [fieldId]: 100 },
      }),
    );
    await new RequestService(repo).resubmit(
      "org",
      "member",
      "request",
      "resubmit-key",
      { expectedRevision: 4 },
    );
    const call = submit.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Resubmission repository was not called");
    expect(call[0].originatingDepartmentId).toBe(departmentId);
  });
});
