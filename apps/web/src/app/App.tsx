import { Route, Routes } from "react-router";
import { WorkflowEditorPage } from "../features/workflows/WorkflowEditorPage";
import { WorkflowListPage } from "../features/workflows/WorkflowListPage";
import { WorkflowSettingsPage } from "../features/workflows/WorkflowSettingsPage";

function HomePage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <p className="font-bold uppercase tracking-widest text-blue-700">
        ApproveFlow
      </p>
      <h1 className="mt-3 text-4xl font-bold">
        Approval workflows, clearly managed.
      </h1>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/organizations/:organizationId/workflows/:workflowId/versions/:versionId"
        element={<WorkflowEditorPage />}
      />
      <Route
        path="/organizations/:organizationId/workflows"
        element={<WorkflowListPage />}
      />
      <Route
        path="/organizations/:organizationId/workflow-settings"
        element={<WorkflowSettingsPage />}
      />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
