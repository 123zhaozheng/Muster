// Route table: each page lives in src/pages/<name>/index.tsx (default export).
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import { Shell } from "./shell/Shell";

const Home = lazy(() => import("./pages/home"));
const Workbench = lazy(() => import("./pages/workbench"));
const Crew = lazy(() => import("./pages/crew"));
const Events = lazy(() => import("./pages/events"));
const Devices = lazy(() => import("./pages/devices"));
const Library = lazy(() => import("./pages/library"));
const Skills = lazy(() => import("./pages/skills"));
const Settings = lazy(() => import("./pages/settings"));
const Inbox = lazy(() => import("./pages/inbox"));
const Costs = lazy(() => import("./pages/costs"));
const Memory = lazy(() => import("./pages/memory"));
const Onboarding = lazy(() => import("./pages/onboarding"));

/** Legacy branches URL: attempts now live in the ticket detail's 方案 tab. */
function LegacyBranches() {
  const { taskId = "" } = useParams();
  return <Navigate to={`/task/${encodeURIComponent(taskId)}?panel=plans`} replace />;
}

export function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="task/:taskId" element={<Workbench />} />
          <Route path="task/:taskId/branches" element={<LegacyBranches />} />
          <Route path="crew" element={<Crew />} />
          <Route path="events" element={<Events />} />
          <Route path="devices" element={<Devices />} />
          <Route path="library" element={<Library />} />
          <Route path="skills" element={<Skills />} />
          <Route path="settings" element={<Settings />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="costs" element={<Costs />} />
          <Route path="memory" element={<Memory />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
