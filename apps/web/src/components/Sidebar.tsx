/**
 * Sidebar — minimal session list: the resident butler ("newhorse") pinned on
 * top, task sessions below, 新任务 button. Refresh is bus-driven via the app
 * store. Session management (rename / archive / delete / fork) is Phase 2.
 */
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Trash2 } from "lucide-react"
import { api } from "../api/client"
import { prettyTitle } from "../api/fold"
import type { SessionRow } from "../api/types"
import { useApp, useStream } from "../state/store"
import { normWorkspace } from "../lib/workspace"
import { Spinner } from "./ui"
import { EmotionBall } from "./EmotionBall"

function statusCls(row: SessionRow, busy: boolean): string {
  if (busy || row.status === "active") return "dot-active"
  if (row.status === "interrupted") return "dot-error"
  return "dot-settled"
}

function Row({ row, selected, onDeleteDone }: { row: SessionRow; selected: boolean; onDeleteDone: (deletedId: string) => void }): React.ReactElement {
  const navigate = useNavigate()
  const { live } = useStream()
  const { refreshSessions } = useApp()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = !!live.get(row.sessionId)?.busy
  const isButler = row.role === "butler"

  const doDelete = (): void => {
    void api
      .deleteSession(row.sessionId)
      .then(() => {
        setConfirming(false)
        refreshSessions()
        onDeleteDone(row.sessionId)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  if (confirming || error) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-bg2 px-2.5 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate text-bad">{error ?? "删除该会话？不可恢复"}</span>
        {!error && (
          <button className="btn btn-danger flex-none !px-2 !py-0.5 !text-2xs" onClick={doDelete}>
            确认删除
          </button>
        )}
        <button
          className="btn flex-none !px-2 !py-0.5 !text-2xs"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
        >
          取消
        </button>
      </div>
    )
  }

  return (
    <div className="group relative">
      <button
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 pr-7 text-left text-xs transition-colors ${
          selected ? "bg-hover-2 text-fg" : "text-dim hover:bg-hover"
        }`}
        onClick={() => navigate(`/s/${row.sessionId}`)}
      >
        {isButler ? <EmotionBall mood={busy ? "thinking" : "idle"} size={22} lite /> : <span className={`dot flex-none ${statusCls(row, busy)}`} />}
        <span className="min-w-0 flex-1 truncate">{isButler ? "newhorse" : prettyTitle(row.title, "未命名会话")}</span>
        {row.origin && <span className="flex-none rounded border border-line px-1 text-2xs uppercase text-ghost group-hover:hidden">{row.origin}</span>}
      </button>
      {!isButler && (
        <button
          className="icon-btn absolute right-1.5 top-1/2 !h-6 !w-6 -translate-y-1/2 opacity-0 transition-opacity hover:!text-bad group-hover:opacity-100"
          title="删除会话"
          onClick={(e) => {
            e.stopPropagation()
            setConfirming(true)
          }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}

export function Sidebar({ selectedId }: { selectedId?: string }): React.ReactElement {
  const navigate = useNavigate()
  const { sessions, sessionsLoading, sessionsError, refreshSessions, workspace } = useApp()
  const { live } = useStream()

  const { butler, tasks } = useMemo(() => {
    const inWs = sessions.filter((r) => normWorkspace(r.workspace) === workspace && !r.archived)
    const butlerRow = inWs.filter((r) => r.role === "butler").sort((a, b) => b.updatedAt - a.updatedAt)[0]
    return { butler: butlerRow, tasks: inWs.filter((r) => r.role !== "butler").sort((a, b) => b.updatedAt - a.updatedAt) }
  }, [sessions, workspace])

  // After a delete: if the deleted row was selected, fall back to "/" so the
  // app resolves the latest remaining session (or the cover when none is left).
  const onDeleted = (deletedId: string): void => {
    if (selectedId === deletedId) navigate("/")
  }

  const newTask = (): void => {
    void api
      .createSession(undefined, workspace || undefined)
      .then((r) => {
        void refreshSessions()
        navigate(`/s/${r.sessionId}`)
      })
      .catch(() => {})
  }

  return (
    <aside className="flex w-60 flex-none flex-col border-r border-line bg-side">
      <div className="flex flex-none items-center gap-2 px-3.5 pb-1 pt-3.5">
        <EmotionBall mood={butler && live.get(butler.sessionId)?.busy ? "thinking" : "idle"} size={22} lite />
        <span className="text-sm font-semibold tracking-wide text-fg">newhorse</span>
      </div>
      {workspace && <div className="flex-none truncate px-3.5 pb-1 text-2xs text-ghost" title={workspace}>{workspace}</div>}
      <div className="flex-none px-3 pb-2 pt-2">
        <button className="btn btn-primary w-full justify-center" onClick={newTask}>
          <Plus size={14} /> 新任务
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sessionsLoading && (
          <div className="flex justify-center py-8">
            <Spinner size={15} />
          </div>
        )}
        {sessionsError && <div className="px-2 py-4 text-xs text-bad">{sessionsError}</div>}
        {butler && (
          <div className="mb-2">
            <Row row={butler} selected={selectedId === butler.sessionId} onDeleteDone={onDeleted} />
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {tasks.map((r) => (
            <Row key={r.sessionId} row={r} selected={selectedId === r.sessionId} onDeleteDone={onDeleted} />
          ))}
        </div>
      </div>
    </aside>
  )
}
