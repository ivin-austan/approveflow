import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export interface PdfSpikeInput {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly generatedAt: string;
}

export interface ApprovedPdfModel {
  readonly requestNumber: string;
  readonly title: string;
  readonly workflowName: string;
  readonly approvedAt: string;
  readonly fields: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly decisions: readonly {
    readonly stage: string;
    readonly approver: string;
    readonly decision: string;
    readonly timestamp: string;
    readonly comment: string | null;
  }[];
}

export const approvedPdfRendererVersion = "approveflow-jspdf-v1";

export function renderApprovedPdf(input: ApprovedPdfModel): Uint8Array {
  const document = new jsPDF({ compress: true, putOnlyUsedFonts: true });
  document.setProperties({
    title: `${input.requestNumber} — Approved`,
    creator: "ApproveFlow",
    subject: "Canonical approved statement",
  });
  document.setCreationDate(new Date(input.approvedAt));
  document.setFileId("415050524F5645464C4F574150505644");
  document.setFont("helvetica", "bold");
  document.setTextColor(4, 120, 87);
  document.text("APPROVED", 14, 17);
  document.setTextColor(23, 32, 51);
  document.setFontSize(16);
  document.text(input.title, 14, 27);
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.text(`${input.requestNumber} · ${input.workflowName}`, 14, 35);
  let fieldTableEnd = 43;
  autoTable(document, {
    startY: 43,
    head: [["Field", "Submitted value"]],
    body: input.fields.map((field) => [field.label, field.value]),
    styles: { overflow: "linebreak", cellPadding: 3 },
    didDrawCell: ({ cell }) => {
      fieldTableEnd = Math.max(fieldTableEnd, cell.y + cell.height + 8);
    },
    didDrawPage: ({ pageNumber }) => {
      document.setFontSize(8);
      document.text(
        `ApproveFlow canonical record · Page ${String(pageNumber)}`,
        14,
        289,
      );
    },
  });
  let decisionTableEnd = fieldTableEnd;
  autoTable(document, {
    startY: fieldTableEnd,
    head: [["Stage", "Approver", "Decision", "Timestamp", "Comment"]],
    body: input.decisions.map((decision) => [
      decision.stage,
      decision.approver,
      decision.decision,
      decision.timestamp,
      decision.comment ?? "",
    ]),
    styles: { overflow: "linebreak", fontSize: 8 },
    didDrawCell: ({ cell }) => {
      decisionTableEnd = Math.max(decisionTableEnd, cell.y + cell.height);
    },
  });
  document.setFontSize(9);
  document.text(
    `Approved at ${input.approvedAt}. This is a system-generated approval record.`,
    14,
    Math.min(280, decisionTableEnd + 10),
  );
  return new Uint8Array(document.output("arraybuffer"));
}

export function renderSpikePdf(input: PdfSpikeInput): Uint8Array {
  const document = new jsPDF({ compress: true, putOnlyUsedFonts: true });
  document.setProperties({ creator: "ApproveFlow" });
  document.setCreationDate(new Date(input.generatedAt));
  document.setFileId("415050524F5645464C4F575350494B45");
  document.setFont("helvetica", "bold");
  document.text(input.title, 14, 18);
  autoTable(document, {
    startY: 26,
    head: [["Field", "Value"]],
    body: input.rows.map(([field, value]) => [field, value]),
    styles: { overflow: "linebreak" },
    didDrawPage: ({ pageNumber }) => {
      document.text(`Page ${String(pageNumber)}`, 180, 287);
    },
  });
  return new Uint8Array(document.output("arraybuffer"));
}
