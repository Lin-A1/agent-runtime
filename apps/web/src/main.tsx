import React from "react"
import ReactDOM from "react-dom/client"
import { createHashRouter, RouterProvider } from "react-router-dom"
import "./index.css"
import { AppShell } from "./components/AppShell"
import { Cover } from "./pages/Cover"
import { SessionPage } from "./pages/Session"
import { SettingsPage } from "./pages/Settings"
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
      // Settings is the hub for config AND the secondary surfaces
      // (usage / schedules / dags / skills / memory / live); both nested
      // /settings/usage and flat /usage deep links map to the right section.
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/:section", element: <SettingsPage /> },
      { path: "usage", element: <SettingsPage initial="usage" /> },
      { path: "memory", element: <SettingsPage initial="memory" /> },
      { path: "schedules", element: <SettingsPage initial="schedules" /> },
      { path: "dags", element: <SettingsPage initial="dags" /> },
      { path: "skills", element: <SettingsPage initial="skills" /> },
      { path: "live", element: <SettingsPage initial="live" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
