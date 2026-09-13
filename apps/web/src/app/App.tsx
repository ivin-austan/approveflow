import { useQuery } from "@tanstack/react-query";
import {
  NavLink,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router";
import { WorkflowEditorPage } from "../features/workflows/WorkflowEditorPage";
import { WorkflowListPage } from "../features/workflows/WorkflowListPage";
import { WorkflowSettingsPage } from "../features/workflows/WorkflowSettingsPage";
import { NewRequestPage } from "../features/requests/NewRequestPage";
import { RequestListPage } from "../features/requests/RequestListPage";
import { RequestTimelinePage } from "../features/requests/RequestTimelinePage";
import { ApprovalInboxPage } from "../features/approvals/ApprovalInboxPage";
import { DocumentDashboardPage } from "../features/dashboard/DocumentDashboardPage";
import { SignInPage } from "../features/auth/SignInPage";
import { authenticatedFetch, setAccessToken } from "../features/auth/session";

interface ContextEnvelope {
  data: {
    fullName?: string;
    email?: string;
    organizationName?: string;
  };
}

function HomePage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <p className="font-bold uppercase tracking-widest text-blue-700">
        ApproveFlow
      </p>
      <h1 className="mt-3 text-4xl font-bold">
        Approval workflows, clearly managed.
      </h1>
      <NavLink className="button-primary mt-6" to="/sign-in">
        Sign in to your workspace
      </NavLink>
    </main>
  );
}

function OrganizationLayout() {
  const { organizationId = "" } = useParams();
  const navigate = useNavigate();
  const session = useQuery({
    queryKey: ["session-context", organizationId],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/v1/context", {
        headers: { "x-organization-id": organizationId },
      });
      if (!response.ok) throw new Error("Unable to load session context");
      return ((await response.json()) as ContextEnvelope).data;
    },
  });
  const items = [
    ["Workflows", "workflows"],
    ["Settings", "workflow-settings"],
    ["Requests", "requests"],
    ["New request", "requests/new"],
    ["Approvals", "approvals"],
  ] as const;
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-5 px-4 py-4 md:px-8">
          <NavLink className="text-xl font-bold text-blue-800" to="/">
            ApproveFlow
          </NavLink>
          <nav
            aria-label="Organization navigation"
            className="flex flex-wrap gap-2"
          >
            {items.map(([label, path]) => (
              <NavLink
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-semibold ${
                    isActive
                      ? "bg-blue-700 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`
                }
                key={path}
                to={`/organizations/${organizationId}/${path}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="hidden text-right sm:block">
              <p className="font-semibold text-slate-800">
                {session.data?.fullName ?? "Signed-in user"}
              </p>
              <p className="text-slate-500">
                {session.data?.organizationName ?? session.data?.email ?? ""}
              </p>
            </div>
            <button
              className="button-secondary"
              onClick={() => {
                void fetch("/api/v1/auth/logout", {
                  method: "POST",
                  credentials: "include",
                }).finally(() => {
                  setAccessToken(null);
                  void navigate("/sign-in", { replace: true });
                });
              }}
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      {session.isError && (
        <div className="mx-auto max-w-6xl px-4 pt-4 md:px-8">
          <div className="issue" role="alert">
            Your session could not be restored. Please sign out and sign in
            again.
          </div>
        </div>
      )}
      <Outlet />
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        path="/organizations/:organizationId"
        element={<OrganizationLayout />}
      >
        <Route path="requests/new" element={<NewRequestPage />} />
        <Route path="requests" element={<RequestListPage />} />
        <Route path="requests/:requestId" element={<RequestTimelinePage />} />
        <Route path="approvals" element={<ApprovalInboxPage />} />
        <Route
          path="document-types/:documentTypeId/dashboard"
          element={<DocumentDashboardPage />}
        />
        <Route
          path="workflows/:workflowId/versions/:versionId"
          element={<WorkflowEditorPage />}
        />
        <Route path="workflows" element={<WorkflowListPage />} />
        <Route path="workflow-settings" element={<WorkflowSettingsPage />} />
      </Route>
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
