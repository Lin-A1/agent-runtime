import React from "react"
import ReactDOM from "react-dom/client"
import { createHashRouter, RouterProvider } from "react-router-dom"
// Self-hosted Inter (the same UI font ZCode remote v4 uses) — bundled so the
// stack renders identically on machines without Inter installed.
import "@fontsource-variable/inter"
import "./index.css"
import { AppShell } from "./components/AppShell"
import { setConnection } from "./api/client"
import { startBus } from "./api/bus"

// Remote-device token handoff: a share link may carry ?token= — store it once,
// then strip it from the URL so it never lingers in history.
;(() => {
  const q = new URLSearchParams(window.location.search)
  const t = q.get("token")
  if (!t) return
  setConnection(window.location.origin, t)
  window.history.replaceState(null, "", window.location.pathname + window.location.hash)
})()

// Hash routing keeps the built bundle servable from any origin by the runtime
// server without server-side route fallback. "/" auto-resolves to the latest
// session (or the cover); "/s/:id" selects one.
startBus()
const router = createHashRouter([
  { path: "/", element: <AppShell /> },
  { path: "/s/:id", element: <AppShell /> },
])

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
