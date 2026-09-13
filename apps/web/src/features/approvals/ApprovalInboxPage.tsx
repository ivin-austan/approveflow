import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { approvalApi, type InboxTask } from "./api";

export function ApprovalInboxPage() {
  const { organizationId = "" } = useParams();
  const client = useQueryClient();
  const [selected, setSelected] = useState<InboxTask | null>(null);
  const [action, setAction] = useState<"APPROVE" | "REJECT" | "RETURN">(
    "APPROVE",
  );
  const [comment, setComment] = useState("");
  const inbox = useQuery({
    queryKey: ["approval-inbox", organizationId],
    queryFn: () => approvalApi.inbox(organizationId),
  });
  const decision = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("No approval selected");
      return approvalApi.decide(organizationId, selected.id, {
        action,
        comment: comment.trim() || null,
        expectedRequestRevision: selected.requestRevision,
      });
    },
    onSuccess: async () => {
      setSelected(null);
      setComment("");
      await client.invalidateQueries({
        queryKey: ["approval-inbox", organizationId],
      });
    },
  });
  return (
    <main className="page">
      <p className="eyebrow">Approvals</p>
      <h1 className="mb-6 text-3xl font-bold">Assigned to me</h1>
      {inbox.isLoading ? (
        <div className="skeleton h-40" aria-label="Loading approvals" />
      ) : inbox.isError ? (
        <div className="issue">Approval tasks could not be loaded.</div>
      ) : inbox.data?.length === 0 ? (
        <div className="empty-state">You’re all caught up.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {inbox.data?.map((task) => (
            <article className="panel" key={task.id}>
              <span className="chip">{task.stageName}</span>
              <h2 className="mt-3 text-lg font-bold">{task.requestTitle}</h2>
              <p className="text-sm text-slate-500">{task.requestNumber}</p>
              <button
                className="button-primary mt-4"
                onClick={() => {
                  setSelected(task);
                }}
              >
                Review
              </button>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <div
          aria-modal="true"
          role="dialog"
          aria-labelledby="decision-title"
          className="fixed inset-0 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <form
            className="panel w-full max-w-lg"
            onSubmit={(event) => {
              event.preventDefault();
              decision.mutate();
            }}
          >
            <h2 id="decision-title" className="text-xl font-bold">
              Decide: {selected.requestTitle}
            </h2>
            <label className="field-label mt-4">
              Action
              <select
                className="field-input"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as typeof action);
                }}
              >
                <option value="APPROVE">Approve</option>
                <option value="RETURN">Return</option>
                <option value="REJECT">Reject</option>
              </select>
            </label>
            <label className="field-label mt-4">
              Comment
              <textarea
                className="field-input"
                required={action !== "APPROVE"}
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                }}
              />
            </label>
            {decision.isError && (
              <div className="issue">
                This action could not be completed. Refresh and try again.
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setSelected(null);
                }}
              >
                Cancel
              </button>
              <button
                className={
                  action === "APPROVE" ? "button-success" : "button-primary"
                }
                disabled={decision.isPending}
                type="submit"
              >
                Confirm {action.toLowerCase()}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
