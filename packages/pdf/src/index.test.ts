import { describe, expect, it } from "vitest";
import { renderSpikePdf } from "./index";

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
