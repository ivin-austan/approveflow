import { Link, useParams } from "react-router";
import { useRequestTimeline } from "./hooks";

export function RequestTimelinePage() {
  const { organizationId = "", requestId = "" } = useParams();
  const timeline = useRequestTimeline(organizationId, requestId);
  if (timeline.isLoading)
    return (
      <main className="page skeleton h-64" aria-label="Loading timeline" />
    );
  if (timeline.isError || !timeline.data)
    return <main className="page issue">This request is unavailable.</main>;
  const data = timeline.data;
  return (
    <main className="page">
      <Link
        className="text-sm text-blue-700 hover:underline"
        to={`/organizations/${organizationId}/requests`}
      >
        Back to requests
      </Link>
      <p className="eyebrow mt-5">{data.request.requestNumber ?? "Draft"}</p>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{data.request.title}</h1>
        <span className="chip">{data.request.status.replaceAll("_", " ")}</span>
      </div>
      <section aria-labelledby="progress-heading" className="panel mb-6">
        <h2 id="progress-heading" className="text-xl font-semibold">
          Approval progress
        </h2>
        {data.stages.length === 0 ? (
          <p className="mt-3 text-slate-500">No approval stages.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {data.stages.map((stage) => (
              <li className="border-l-4 border-blue-200 pl-4" key={stage.id}>
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>
                    {stage.levelNumber}. {stage.name}
                    {stage.isFinal ? " (Final)" : ""}
                  </strong>
                  <span className="chip">{stage.status}</span>
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  Due: {formatDate(stage.dueAt)}
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {stage.tasks.map((task) => (
                    <li key={task.id}>
                      {task.assigneeName}: {task.status.replaceAll("_", " ")}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-labelledby="timeline-heading" className="panel">
        <h2 id="timeline-heading" className="text-xl font-semibold">
          Audit timeline
        </h2>
        {data.events.length === 0 ? (
          <p className="mt-3 text-slate-500">No recorded events.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {data.events.map((event) => (
              <li className="border-b pb-4 last:border-0" key={event.id}>
                <div className="font-medium">
                  {event.eventType.replaceAll("_", " ")}
                </div>
                <time className="text-sm text-slate-500">
                  {formatDate(event.occurredAt)}
                </time>
                {typeof event.payload.comment === "string" && (
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {event.payload.comment}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not configured";
}
