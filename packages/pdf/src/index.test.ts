import { describe, expect, it } from "vitest";
import { renderApprovedPdf, renderSpikePdf } from "./index";

const input = {
  title: "Approved statement",
  generatedAt: "2026-01-01T00:00:00.000Z",
  rows: Array.from(
    { length: 120 },
    (_, index) =>
      [
        `Field ${String(index)}`,
        `A long, wrapping value for deterministic pagination ${String(index)}`,
      ] as const,
  ),
};

describe("jsPDF backend spike", () => {
  it("renders deterministic, paginated table bytes for a fixed model", () => {
    const first = renderSpikePdf(input);
    const second = renderSpikePdf(input);
    expect(first.byteLength).toBeGreaterThan(1_000);
    expect(first).toEqual(second);
  });
});

describe("canonical approved PDF", () => {
  it("renders deterministically from the shared typed model", () => {
    const model = {
      requestNumber: "FIN/PUR/2026/000001",
      title: "Laptop",
      workflowName: "Purchase approval",
      approvedAt: "2026-01-01T00:00:00.000Z",
      fields: [{ label: "Amount", value: "AED 5,000" }],
      decisions: [
        {
          stage: "Manager",
          approver: "A. Approver",
          decision: "Approved",
          timestamp: "2026-01-01T00:00:00.000Z",
          comment: "Approved",
        },
      ],
    };
    expect(renderApprovedPdf(model)).toEqual(renderApprovedPdf(model));
  });
});
