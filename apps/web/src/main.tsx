import React from "react"
import ReactDOM from "react-dom/client"
import { createHashRouter, RouterProvider } from "react-router-dom"
import "./index.css"
import { AppShell } from "./components/AppShell"
import { Cover } from "./pages/Cover"
import { SessionPage } from "./pages/Session"
import { SettingsPage } from "./pages/Settings"
import { NotFound } from "./pages/NotFound"
import { setConnection } from "./api/client"

// Remote-device token handoff: the share link carries ?token= (opt-in in the
// remote-access dialog) — store it once, then strip it from the URL so it
// never lingers in history.
;(() => {
  const q = new URLSearchParams(window.location.search)
  const t = q.get("token")
  if (!t) return
  setConnection(window.location.origin, t)
  window.history.replaceState(null, "", window.location.pathname + window.location.hash)
})()

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
