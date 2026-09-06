/**
 * AppShell — Minimal two-column chat with full mobile drawer support:
 * - Desktop: Sidebar on left + Transcript and centered/docked Composer on right
 * - Mobile: Responsive topbar with hamburger button + sliding off-canvas drawer
 * - Composer placement:
 *   - Desktop empty state: centered in the middle of the screen stage
 *   - Mobile or active conversation: anchored at the bottom with safe-area spacing
 */
import { useCallback, useEffect, useState, type ReactElement } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Menu, Plus } from "lucide-react"
import { api } from "../api/client"
import { AppProvider, StreamProvider, useApp } from "../state/store"
import { Sidebar } from "./Sidebar"
import { Transcript } from "./Transcript"
import { EmotionBall, HeroParticles } from "./EmotionBall"
import { BrandWordmark } from "./BrandWordmark"
import { LoadingState } from "./ui"

function Cover({ onOpenMobileNav }: { onOpenMobileNav: () => void }): ReactElement {
  const navigate = useNavigate()
  const { workspace, refreshSessions } = useApp()

  const startNew = (): void => {
    void api
      .createSession(undefined, workspace || undefined)
      .then((r) => {
        void refreshSessions()
        navigate(`/s/${r.sessionId}`)
      })
      .catch(() => {})
  }

  return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-none items-center justify-between border-b border-line bg-panel/60 px-4 py-2.5 pt-safe-top backdrop-blur-md md:hidden">
          <button type="button" className="icon-btn !h-9 !w-9 text-fg" title="打开侧边栏" onClick={onOpenMobileNav}><Menu size={18} /></button>
          <BrandWordmark size="sm" />
          <div className="w-9" />
        </div>
        <div className="relative flex min-h-full flex-1 flex-col items-center justify-center gap-7 px-5 py-12 sm:px-10">
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-45" aria-hidden="true"><HeroParticles className="h-full w-full" /></div>
          <div className="relative z-10 flex flex-col items-center gap-5 text-center">
            <EmotionBall mood="idle" size={154} interactive hasRing className="float-gentle" />
            <div><BrandWordmark size="sm" /><p className="mt-2 text-sm text-faint">把复杂工作交给一个会持续工作的 agent。</p></div>
            <div className="w-full max-w-2xl"><button type="button" className="btn btn-primary text-xs" onClick={startNew}><Plus size={14} /> 新建会话</button></div>
          </div>
        </div>
      </div>
  )
}

function Shell(): ReactElement {
  const { id } = useParams()
  const navigate = useNavigate()
  const { sessions, sessionsLoading, refreshSessions, workspace } = useApp()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Default-session resolution: latest task session, else the butler.
  useEffect(() => {
    if (id || sessionsLoading || sessions.length === 0) return
    const inWs = sessions.filter((r) => r.workspace === workspace || !workspace)
    const pick = inWs.filter((r) => r.role !== "butler").sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? inWs.find((r) => r.role === "butler")
    if (pick) navigate(`/s/${pick.sessionId}`, { replace: true })
  }, [id, sessions, sessionsLoading, workspace, navigate])

  const handleNewTask = useCallback((): void => {
    void api
      .createSession(undefined, workspace || undefined)
      .then((r) => {
        void refreshSessions()
        navigate(`/s/${r.sessionId}`)
        setMobileNavOpen(false)
      })
      .catch(() => {})
  }, [navigate, refreshSessions, workspace])

  // Global shortcuts: Ctrl/Cmd+N creates a task, Ctrl/Cmd+K focuses the
  // sidebar session filter. Text inputs keep ownership of these key chords.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const editable = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      if (e.key === "n" || e.key === "N") {
        if (editable) return
        e.preventDefault()
        handleNewTask()
      } else if (e.key === "k" || e.key === "K") {
        if (editable) return
        e.preventDefault()
        window.dispatchEvent(new CustomEvent("nh-open-search"))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [handleNewTask])

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar
        selectedId={id}
        mobileOpen={mobileNavOpen}
        onOpenMobile={() => setMobileNavOpen(true)}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col relative">
        {id ? (
          <>
            <Transcript
              key={id}
              sessionId={id}
              mobileNavOpen={mobileNavOpen}
              onOpenMobileNav={() => setMobileNavOpen(true)}
              onNewTask={handleNewTask}
            />

          </>
        ) : sessionsLoading ? (
          <LoadingState />
        ) : (
          <Cover onOpenMobileNav={() => setMobileNavOpen(true)} />
        )}
      </main>
    </div>
  )
}

export function AppShell(): ReactElement {
  return (
    <AppProvider>
      <StreamProvider>
        <Shell />
      </StreamProvider>
    </AppProvider>
  )
}
