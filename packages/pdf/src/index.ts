import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface PdfSpikeInput {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly generatedAt: string;
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
