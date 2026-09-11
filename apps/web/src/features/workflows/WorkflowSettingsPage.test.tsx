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
import { WorkflowSettingsPage } from "./WorkflowSettingsPage";

const organizationId = "11111111-1111-4111-8111-111111111111";
const calendarId = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkflowSettingsPage", () => {
  it("submits configurable numbering and automatic approval policy", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const data = url.endsWith("/business-calendars")
        ? [{ id: calendarId, name: "Dubai office", timezone: "Asia/Dubai" }]
        : [];
      return Promise.resolve(
        new Response(JSON.stringify({ data }), {
          status: init?.method === "POST" ? 201 : 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter
          initialEntries={[
            `/organizations/${organizationId}/workflow-settings`,
          ]}
        >
          <Routes>
            <Route
              path="/organizations/:organizationId/workflow-settings"
              element={<WorkflowSettingsPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("option", { name: "Dubai office" });
    fireEvent.change(screen.getByLabelText("Business calendar"), {
      target: { value: calendarId },
    });
    const documentName = screen.getAllByLabelText("Name").at(1);
    if (!documentName) throw new Error("Document type name input is missing");
    fireEvent.change(documentName, {
      target: { value: "Purchase Order" },
    });
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "PO" },
    });
    fireEvent.change(screen.getByLabelText("Sequence digits"), {
      target: { value: "8" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "Automatically approve incomplete stages after a threshold",
      ),
    );
    fireEvent.change(screen.getByLabelText("Approval threshold"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Business-time unit"), {
      target: { value: "BUSINESS_HOURS" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add document type" }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([input, init]) =>
          (input instanceof Request ? input.url : String(input)).endsWith(
            "/document-types",
          ) && init?.method === "POST",
      );
      const body = request?.[1]?.body;
      if (typeof body !== "string") throw new Error("Request body is missing");
      expect(JSON.parse(body) as unknown).toMatchObject({
        code: "PO",
        sequencePadding: 8,
        automaticApproval: {
          enabled: true,
          after: { value: 12, unit: "BUSINESS_HOURS" },
        },
      });
    });
  });
});
