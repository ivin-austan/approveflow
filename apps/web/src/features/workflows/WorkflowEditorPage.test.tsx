import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowEditorPage } from "./WorkflowEditorPage";
import type { WorkflowDraft } from "./types";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  workflow: "22222222-2222-4222-8222-222222222222",
  version: "33333333-3333-4333-8333-333333333333",
};
const draft: WorkflowDraft = {
  workflowId: ids.workflow,
  versionId: ids.version,
  revision: 1,
  allowRequesterSelfApproval: false,
  allowNoStageAutomaticApproval: false,
  formSections: [],
  fieldConditions: [],
  stages: ["Finance review", "Director approval"].map((name, index) => ({
    id: `${String(index + 4)}4444444-4444-4444-8444-444444444444`,
    name,
    description: null,
    instructions: null,
    position: index + 1,
    completionPolicy: "ANY",
    dueDuration: null,
    businessCalendarId: null,
    activationCondition: null,
    approvers: [
      {
        id: `${String(index + 6)}6666666-6666-4666-8666-666666666666`,
        assignmentType: "REQUESTER_MANAGER",
        displayOrder: 1,
      },
    ],
    reminders: [],
    escalations: [],
  })),
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const requestUrl = (input: RequestInfo | URL) =>
  input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : input;
const mockApi = (workflowDraft = draft) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data:
              requestUrl(input).includes("approver-options") ||
              requestUrl(input).includes("business-calendars")
                ? []
                : workflowDraft,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    ),
  );
describe("WorkflowEditorPage", () => {
  it("supports accessible reorder while preserving stable stage ids", async () => {
    mockApi();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter
          initialEntries={[
            `/organizations/${ids.organization}/workflows/${ids.workflow}/versions/${ids.version}`,
          ]}
        >
          <Routes>
            <Route
              path="/organizations/:organizationId/workflows/:workflowId/versions/:versionId"
              element={<WorkflowEditorPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByDisplayValue("Finance review");
    fireEvent.click(
      screen.getByRole("button", { name: "Move Director approval up" }),
    );
    expect(screen.getByDisplayValue("Director approval")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Director approval").closest("li"),
    ).toHaveAttribute("aria-label", "Approval level 1");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("adds arbitrary approval levels and keeps positions contiguous", async () => {
    mockApi();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter
          initialEntries={[
            `/organizations/${ids.organization}/workflows/${ids.workflow}/versions/${ids.version}`,
          ]}
        >
          <Routes>
            <Route
              path="/organizations/:organizationId/workflows/:workflowId/versions/:versionId"
              element={<WorkflowEditorPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /add approval level/i }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Approval level 3")).toBeInTheDocument(),
    );
  });

  it("sends representative form answers when previewing a conditional path", async () => {
    const fieldId = "88888888-8888-4888-8888-888888888888";
    mockApi({
      ...draft,
      formSections: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          stableKey: "request",
          name: "Request",
          description: null,
          position: 1,
          fields: [
            {
              id: fieldId,
              stableKey: "amount",
              label: "Amount",
              type: "NUMBER" as const,
              description: null,
              required: true,
              position: 1,
              config: {},
              options: [],
            },
          ],
        },
      ],
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter
          initialEntries={[
            `/organizations/${ids.organization}/workflows/${ids.workflow}/versions/${ids.version}`,
          ]}
        >
          <Routes>
            <Route
              path="/organizations/:organizationId/workflows/:workflowId/versions/:versionId"
              element={<WorkflowEditorPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText("Representative preview answers"));
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "2500" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Preview$/ }));
    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const previewCall = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).endsWith("/preview"),
      );
      expect(previewCall?.[1]?.body).toBe(
        JSON.stringify({ answers: { [fieldId]: 2500 } }),
      );
    });
  });
});
