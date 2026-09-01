import React from "react"
import ReactDOM from "react-dom/client"
import { createHashRouter, RouterProvider } from "react-router-dom"
import "./index.css"
import { AppShell } from "./components/AppShell"
import { Cover } from "./pages/Cover"
import { SessionPage } from "./pages/Session"
import { SettingsPage } from "./pages/Settings"
import { UsagePage } from "./pages/Usage"
import { MemoryPage } from "./pages/Memory"
import { SchedulesPage } from "./pages/Schedules"
import { DagsPage } from "./pages/Dags"
import { LivePage } from "./pages/Live"
import { NotFound } from "./pages/NotFound"

// Hash routing keeps the built bundle servable from any origin/sub-path by the
// runtime server without server-side route fallback.
const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Cover /> },
      { path: "session/:id", element: <SessionPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "usage", element: <UsagePage /> },
      { path: "memory", element: <MemoryPage /> },
      { path: "schedules", element: <SchedulesPage /> },
      { path: "dags", element: <DagsPage /> },
      { path: "live", element: <LivePage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
