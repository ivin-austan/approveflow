import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { dashboardApi, type DashboardFilters } from "./api";

function withoutCursor(filters: DashboardFilters) {
  const next = { ...filters };
  delete next.cursor;
  return next;
}

export function DocumentDashboardPage() {
  const { organizationId = "", documentTypeId = "" } = useParams();
  const [filters, setFilters] = useState<DashboardFilters>({
    sort: "updatedAt",
    direction: "desc",
  });
  const [accessError, setAccessError] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [operationError, setOperationError] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const dashboard = useQuery({
    queryKey: ["document-dashboard", organizationId, documentTypeId, filters],
    queryFn: () => dashboardApi.list(organizationId, documentTypeId, filters),
  });
  const openArtifact = async (
    artifactId: string | null,
    purpose: "VIEW" | "PRINT" | "DOWNLOAD",
  ) => {
    if (!artifactId) return;
    setAccessError(false);
    try {
      const blob = await dashboardApi.artifact(
        organizationId,
        artifactId,
        purpose,
      );
      const url = URL.createObjectURL(blob);
      if (purpose === "PRINT") {
        const printWindow = window.open(url, "_blank", "noopener,noreferrer");
        if (!printWindow) throw new Error("The print window was blocked.");
        printWindow.addEventListener("load", () => {
          printWindow.print();
        });
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60_000);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      if (purpose === "DOWNLOAD") anchor.download = "approved-document.pdf";
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch {
      setAccessError(true);
    }
  };
  const exportCsv = async () => {
    setExportError(false);
    try {
      const blob = await dashboardApi.exportCsv(
        organizationId,
        documentTypeId,
        filters,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "approveflow-documents.csv";
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch {
      setExportError(true);
    }
  };
  const operate = async (key: string, operation: () => Promise<unknown>) => {
    setOperationError(false);
    setPendingAction(key);
    try {
      await operation();
      await dashboard.refetch();
    } catch {
      setOperationError(true);
    } finally {
      setPendingAction(null);
    }
  };
  const metrics = dashboard.data?.metrics ?? {};
  return (
    <main className="page">
      <p className="eyebrow">Documents</p>
      <h1 className="text-3xl font-bold">Document dashboard</h1>
      <section
        aria-label="Document metrics"
        className="my-6 grid gap-3 sm:grid-cols-3"
      >
        {["IN_REVIEW", "APPROVED", "RETURNED"].map((status) => (
          <div className="panel" key={status}>
            <div className="text-sm text-slate-500">
              {status.replaceAll("_", " ")}
            </div>
            <div className="text-2xl font-bold">{metrics[status] ?? 0}</div>
          </div>
        ))}
      </section>
      <div className="panel mb-5 grid gap-4 md:grid-cols-4">
        <label className="field-label">
          Search
          <input
            className="field-input"
            value={filters.search ?? ""}
            onChange={(event) => {
              setFilters((current) => ({
                ...withoutCursor(current),
                search: event.target.value,
              }));
            }}
          />
        </label>
        <label className="field-label">
          Status
          <select
            className="field-input"
            value={filters.status ?? ""}
            onChange={(event) => {
              const status = event.target.value;
              setFilters((current) => {
                const next = withoutCursor(current);
                delete next.status;
                return status ? { ...next, status } : next;
              });
            }}
          >
            <option value="">All</option>
            {[
              "DRAFT",
              "IN_REVIEW",
              "APPROVED",
              "REJECTED",
              "RETURNED",
              "CANCELLED",
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Sort
          <select
            className="field-input"
            value={filters.sort}
            onChange={(event) => {
              const sort = event.target.value;
              if (
                sort === "updatedAt" ||
                sort === "requestNumber" ||
                sort === "title"
              ) {
                setFilters((current) => ({
                  ...withoutCursor(current),
                  sort,
                }));
              }
            }}
          >
            <option value="updatedAt">Updated</option>
            <option value="requestNumber">Request number</option>
            <option value="title">Title</option>
          </select>
        </label>
        <button
          className="button-secondary self-end"
          onClick={() => {
            void exportCsv();
          }}
        >
          Export CSV
        </button>
      </div>
      {accessError && (
        <div className="issue">The approved PDF could not be opened.</div>
      )}
      {exportError && <div className="issue">The CSV export failed.</div>}
      {operationError && (
        <div className="issue">
          The operational action could not be completed.
        </div>
      )}
      {dashboard.isLoading ? (
        <div className="skeleton h-56" />
      ) : dashboard.isError ? (
        <div className="issue">Dashboard data could not be loaded.</div>
      ) : dashboard.data?.rows.length === 0 ? (
        <div className="empty-state">No matching documents.</div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-sm text-slate-500">
                <th className="p-3">Document</th>
                <th className="p-3">Status</th>
                <th className="p-3">Stage</th>
                <th className="p-3">PDF / delivery</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.data?.rows.map((row) => (
                <tr className="border-b last:border-0" key={row.id}>
                  <td className="p-3">
                    <div className="font-semibold">{row.title}</div>
                    <div className="text-sm text-slate-500">
                      {row.requestNumber ?? "Draft"}
                    </div>
                  </td>
                  <td className="p-3">{row.status}</td>
                  <td className="p-3">{row.currentStage ?? "\u2014"}</td>
                  <td className="p-3">
                    <div>{row.artifactStatus ?? "Not generated"}</div>
                    <div className="text-sm text-slate-500">
                      {row.deliveryStatus ?? "\u2014"}
                    </div>
                  </td>
                  <td className="p-3">
                    {row.artifactId && row.artifactStatus === "READY" ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="button-secondary"
                          onClick={() => {
                            void openArtifact(row.artifactId, "VIEW");
                          }}
                        >
                          View
                        </button>
                        <button
                          className="button-secondary"
                          onClick={() => {
                            void openArtifact(row.artifactId, "PRINT");
                          }}
                        >
                          Print
                        </button>
                        <button
                          className="button-secondary"
                          onClick={() => {
                            void openArtifact(row.artifactId, "DOWNLOAD");
                          }}
                        >
                          Download
                        </button>
                        <button
                          className="button-secondary"
                          disabled={pendingAction !== null}
                          onClick={() => {
                            if (
                              row.legalHold &&
                              !window.confirm(
                                "Release this legal hold? An expired artifact may then be deleted by retention processing.",
                              )
                            )
                              return;
                            void operate(`hold:${row.artifactId ?? ""}`, () =>
                              dashboardApi.setLegalHold(
                                organizationId,
                                row.artifactId ?? "",
                                !row.legalHold,
                              ),
                            );
                          }}
                        >
                          {row.legalHold ? "Release hold" : "Apply legal hold"}
                        </button>
                        {row.deliveryId &&
                          row.deliveryStatus === "PERMANENTLY_FAILED" && (
                            <button
                              className="button-secondary"
                              disabled={pendingAction !== null}
                              onClick={() => {
                                void operate(
                                  `delivery:${row.deliveryId ?? ""}`,
                                  () =>
                                    dashboardApi.reopenDelivery(
                                      organizationId,
                                      row.deliveryId ?? "",
                                    ),
                                );
                              }}
                            >
                              Reopen delivery
                            </button>
                          )}
                      </div>
                    ) : row.artifactId &&
                      row.artifactStatus === "PERMANENTLY_FAILED" ? (
                      <button
                        className="button-secondary"
                        disabled={pendingAction !== null}
                        onClick={() => {
                          void operate(`artifact:${row.artifactId ?? ""}`, () =>
                            dashboardApi.retryArtifact(
                              organizationId,
                              row.artifactId ?? "",
                            ),
                          );
                        }}
                      >
                        Retry PDF
                      </button>
                    ) : row.deliveryId &&
                      row.deliveryStatus === "PERMANENTLY_FAILED" ? (
                      <button
                        className="button-secondary"
                        disabled={pendingAction !== null}
                        onClick={() => {
                          void operate(`delivery:${row.deliveryId ?? ""}`, () =>
                            dashboardApi.reopenDelivery(
                              organizationId,
                              row.deliveryId ?? "",
                            ),
                          );
                        }}
                      >
                        Reopen delivery
                      </button>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {dashboard.data?.nextCursor && (
            <button
              className="button-secondary mt-4"
              onClick={() => {
                const nextCursor = dashboard.data.nextCursor;
                if (nextCursor) setFilters({ ...filters, cursor: nextCursor });
              }}
            >
              Next page
            </button>
          )}
        </div>
      )}
    </main>
  );
}
