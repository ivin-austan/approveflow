import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { workflowApi } from "./api";

export function WorkflowListPage() {
  const { organizationId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["workflows", organizationId],
    queryFn: () => workflowApi.list(organizationId),
  });
  const types = useQuery({
    queryKey: ["document-types", organizationId],
    queryFn: () => workflowApi.documentTypes(organizationId),
  });
  const [name, setName] = useState("");
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="page">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1 className="text-3xl font-bold">Workflows</h1>
          <p className="text-slate-600">
            Create, publish, and maintain versioned approval definitions.
          </p>
        </div>
        <Link
          className="button-secondary"
          to={`/organizations/${organizationId}/workflow-settings`}
        >
          Calendar & document types
        </Link>
      </header>
      <form
        className="panel mb-6 grid gap-3 md:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          void workflowApi
            .create(organizationId, { name, documentTypeId, description: null })
            .then(async (created) => {
              await client.invalidateQueries({
                queryKey: ["workflows", organizationId],
              });
              void navigate(
                `/organizations/${organizationId}/workflows/${created.id}/versions/${created.draftVersionId}`,
              );
            })
            .catch(() => {
              setError("Could not create workflow.");
            });
        }}
      >
        <label className="field-label">
          Workflow name
          <input
            required
            className="field-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className="field-label">
          Document type
          <select
            required
            className="field-input"
            value={documentTypeId}
            onChange={(e) => {
              setDocumentTypeId(e.target.value);
            }}
          >
            <option value="">Select…</option>
            {types.data?.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button-primary self-end" type="submit">
          Create workflow
        </button>
        {error && <p className="issue md:col-span-3">{error}</p>}
      </form>
      {query.isLoading ? (
        <div className="skeleton h-40" />
      ) : query.data?.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {query.data.map((workflow) => (
            <article className="panel" key={workflow.id}>
              <div className="flex justify-between">
                <h2 className="text-xl font-bold">{workflow.name}</h2>
                <span className="chip">
                  {workflow.currentPublishedVersionId ? "Published" : "Draft"}
                </span>
              </div>
              <p className="mt-2 text-slate-600">
                {workflow.description ?? "No description"}
              </p>
              {workflow.currentPublishedVersionId && (
                <Link
                  className="mt-4 inline-block text-blue-700 underline"
                  to={`/organizations/${organizationId}/workflows/${workflow.id}/versions/${workflow.currentPublishedVersionId}`}
                >
                  View published version
                </Link>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          No workflows yet. Create the first workflow above.
        </div>
      )}
    </main>
  );
}
