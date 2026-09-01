/**
 * App shell — persistent sidebar + routed content + the Ctrl+K palette.
 * A region-level error boundary keeps one failing page from white-screening
 * the whole app (pre-review #29; 全局兜底页).
 */
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import { AlertTriangle } from "lucide-react"
import { Sidebar } from "./Sidebar"
import { CommandPalette } from "./CommandPalette"

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
            <p className="mt-2 max-w-md truncate font-mono text-2xs text-ghost">{this.state.error.message}</p>
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

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Boundary key={location.pathname}>
          <Outlet />
        </Boundary>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
