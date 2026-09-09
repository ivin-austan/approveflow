import { Route, Routes } from "react-router";

function HomePage() {
  return (
    <main>
      <p className="eyebrow">ApproveFlow</p>
      <h1>Approval workflows, clearly managed.</h1>
      <p>The Phase 2 application foundation is running.</p>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
