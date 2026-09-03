/**
 * AppShell — minimal two-column chat: session list / transcript + composer.
 * Owns the providers (app store + live streams), the bus bootstrap and
 * default-session resolution. Right pane, command palette and session
 * management return in Phase 2.
 */
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MessageSquarePlus } from "lucide-react"
import { startBus } from "../api/bus"
import { api } from "../api/client"
import { AppProvider, StreamProvider, useApp } from "../state/store"
import { Sidebar } from "./Sidebar"
import { Transcript } from "./Transcript"
import { Composer } from "./Composer"
import { EmotionBall } from "./EmotionBall"
import { LoadingState } from "./ui"

function Cover(): React.ReactElement {
  const navigate = useNavigate()
  const { workspace, refreshSessions } = useApp()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="float-gentle">
          <EmotionBall mood="listening" size={144} interactive hasRing />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-fg">newhorse</h2>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-dim">
            模型无关的智能体引擎。支持代码编写、文件检索、网络查询与动态渲染。
          </p>
        </div>
      </div>
      <button
        className="btn btn-primary px-5 py-2 text-sm shadow-md"
        onClick={() => {
          void api
            .createSession(undefined, workspace || undefined)
            .then((r) => {
              void refreshSessions()
              navigate(`/s/${r.sessionId}`)
            })
            .catch(() => {})
        }}
      >
        <MessageSquarePlus size={15} /> 新任务
      </button>
    </div>
  )
}

function Shell(): React.ReactElement {
  const { id } = useParams()
  const navigate = useNavigate()
  const { sessions, sessionsLoading, workspace } = useApp()

  // Default-session resolution: latest task session, else the butler.
  useEffect(() => {
    if (id || sessionsLoading || sessions.length === 0) return
    const inWs = sessions.filter((r) => r.workspace === workspace || !workspace)
    const pick = inWs.filter((r) => r.role !== "butler").sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? inWs.find((r) => r.role === "butler")
    if (pick) navigate(`/s/${pick.sessionId}`, { replace: true })
  }, [id, sessions, sessionsLoading, workspace, navigate])

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar selectedId={id} />
      <main className="flex min-w-0 flex-1 flex-col">
        {id ? (
          <>
            <Transcript key={id} sessionId={id} />
            <Composer key={`c-${id}`} sessionId={id} />
          </>
        ) : sessionsLoading ? (
          <LoadingState />
        ) : (
          <Cover />
        )}
      </main>
    </div>
  )
}

export function AppShell(): React.ReactElement {
  return (
    <AppProvider>
      <StreamProvider>
        <Shell />
      </StreamProvider>
    </AppProvider>
  )
}
