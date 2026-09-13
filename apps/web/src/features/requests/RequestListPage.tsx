import { Link, useParams } from "react-router";
import { useRequests, useResubmitRequest } from "./hooks";

export function RequestListPage() {
  const { organizationId = "" } = useParams();
  const query = useRequests(organizationId);
  const resubmit = useResubmitRequest(organizationId);
  return (
    <main className="page">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="eyebrow">ApproveFlow</p>
          <h1 className="text-3xl font-bold">My requests</h1>
        </div>
        <Link
          className="button-primary"
          to={`/organizations/${organizationId}/requests/new`}
        >
          New request
        </Link>
      </div>
      {query.isLoading ? (
        <div className="skeleton h-40" aria-label="Loading requests" />
      ) : query.isError ? (
        <div className="issue">Requests could not be loaded.</div>
      ) : query.data?.length === 0 ? (
        <div className="empty-state">No requests yet.</div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-sm text-slate-500">
                <th className="p-3">Request</th>
                <th className="p-3">Status</th>
                <th className="p-3">Current stage</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((item) => (
                <tr className="border-b last:border-0" key={item.id}>
                  <td className="p-3">
                    <Link
                      className="font-semibold text-blue-700 hover:underline"
                      to={`/organizations/${organizationId}/requests/${item.id}`}
                    >
                      {item.title}
                    </Link>
                    <div className="text-sm text-slate-500">
                      {item.requestNumber ?? "Draft"}
                    </div>
                    {item.status === "RETURNED" && (
                      <button
                        className="button-secondary mt-2"
                        disabled={resubmit.isPending}
                        onClick={() => {
                          resubmit.mutate({
                            requestId: item.id,
                            expectedRevision: item.revision,
                          });
                        }}
                      >
                        Resubmit
                      </button>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="chip">
                      {item.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="p-3">{item.currentStage ?? "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
