/**
 * App shell — persistent sidebar + routed content + Ctrl+K palette + the
 * remote-access QR dialog. Responsive: on desktop the sidebar is a fixed rail;
 * on ≤768px it collapses to a drawer behind a hamburger (mobile web / remote
 * control), and the session sidePane becomes a bottom sheet (in Session page).
 * Region-level error boundary keeps one failing page from white-screening.
 */
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { AlertTriangle, Menu, X } from "lucide-react"
import { Sidebar } from "./Sidebar"
import { CommandPalette } from "./CommandPalette"
import { RemoteAccess } from "./RemoteAccess"
import { startBus } from "../api/bus"

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("region error", error, info)
  }
  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-bg2 text-bad">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-sm font-medium text-fg">页面出错了</p>
            <p className="mt-1 max-w-md text-xs text-faint">错误已经限制在当前区域，侧栏与其他页面不受影响。</p>
          </div>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            重试此区域
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function AppShell(): React.ReactElement {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const location = useLocation()

  // One global SSE connection for the whole app (opencode /api/event pump).
  useEffect(() => startBus(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      {/* mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-panel px-3 md:hidden">
        <button className="icon-btn !h-9 !w-9" aria-label="打开侧栏" onClick={() => setDrawerOpen(true)}>
          <Menu size={18} />
        </button>
        <span className="text-sm font-semibold">newhorse</span>
      </div>

      {/* desktop rail */}
      <div className="hidden md:flex">
        <Sidebar collapsed={railCollapsed} onToggleCollapse={() => setRailCollapsed((v) => !v)} onOpenRemote={() => setRemoteOpen(true)} />
      </div>

      {/* mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" style={{ background: "var(--scrim)" }} onClick={() => setDrawerOpen(false)}>
          <div
            className="absolute left-0 top-0 h-full w-[280px] max-w-[85%] overflow-hidden shadow-overlay"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="icon-btn absolute right-2 top-2 z-10 !h-9 !w-9" aria-label="关闭侧栏" onClick={() => setDrawerOpen(false)}>
              <X size={18} />
            </button>
            <Sidebar onOpenRemote={() => {
              setDrawerOpen(false)
              setRemoteOpen(true)
            }} />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden pt-12 md:pt-0">
        <Boundary key={location.pathname}>
          <Outlet context={{ onOpenRemote: () => setRemoteOpen(true) }} />
        </Boundary>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <RemoteAccess open={remoteOpen} onClose={() => setRemoteOpen(false)} />
    </div>
  )
}
