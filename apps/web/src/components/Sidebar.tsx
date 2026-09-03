/**
 * Sidebar — session tree & management:
 * - Brand header: exclusive mini Emo Ball (no ring, cute & lively)
 * - Resident Butler row: Emo Ball avatar, no extra '管家' text badge
 * - Clean session list: smooth hover, clear active indicator
 * - In-place non-destructive deletion: slick inline confirm without layout shift
 */
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Moon, Plus, Sun, Trash2, X } from "lucide-react"
import { api } from "../api/client"
import { prettyTitle } from "../api/fold"
import type { SessionRow } from "../api/types"
import { useApp, useStream } from "../state/store"
import { normWorkspace } from "../lib/workspace"
import { useTheme } from "../lib/theme"
import { Spinner } from "./ui"
import { EmotionBall } from "./EmotionBall"

function statusCls(row: SessionRow, busy: boolean): string {
  if (busy || row.status === "active") return "dot-active"
  if (row.status === "interrupted") return "dot-error"
  return "dot-settled"
}

function Row({
  row,
  selected,
  onDeleteDone,
}: {
  row: SessionRow
  selected: boolean
  onDeleteDone: (deletedId: string) => void
}): React.ReactElement {
  const navigate = useNavigate()
  const { live } = useStream()
  const { refreshSessions } = useApp()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const busy = !!live.get(row.sessionId)?.busy
  const isButler = row.role === "butler"

  const doDelete = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setDeleting(true)
    void api
      .deleteSession(row.sessionId)
      .then(() => {
        setConfirming(false)
        setDeleting(false)
        refreshSessions()
        onDeleteDone(row.sessionId)
      })
      .catch(() => {
        setDeleting(false)
        setConfirming(false)
      })
  }

  // In-place inline confirmation: preserves exact row height & layout
  if (confirming) {
    return (
      <div className="flex h-8 w-full items-center justify-between rounded-lg bg-bad/10 px-2 text-xs border border-bad/30">
        <span className="truncate text-2xs font-medium text-bad">确认删除该会话？</span>
        <div className="flex items-center gap-1 flex-none">
          <button
            className="rounded px-1.5 py-0.5 text-2xs text-dim hover:bg-hover hover:text-fg transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              setConfirming(false)
            }}
          >
            取消
          </button>
          <button
            className="rounded bg-bad px-2 py-0.5 text-2xs font-medium text-white hover:bg-bad/90 transition-colors"
            disabled={deleting}
            onClick={doDelete}
          >
            {deleting ? <Spinner size={10} /> : "删除"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative flex items-center">
      <button
        className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs transition-colors ${
          selected ? "bg-hover-2 text-fg font-medium" : "text-dim hover:bg-hover hover:text-fg"
        }`}
        onClick={() => navigate(`/s/${row.sessionId}`)}
      >
        {isButler ? (
          <EmotionBall mood={busy ? "thinking" : "idle"} size={20} lite hasRing={false} />
        ) : (
          <span className={`dot flex-none ${statusCls(row, busy)}`} />
        )}
        <span className="min-w-0 flex-1 truncate">{isButler ? "newhorse" : prettyTitle(row.title, "未命名会话")}</span>
        {row.origin && (
          <span className="flex-none rounded border border-line px-1 text-2xs uppercase text-ghost group-hover:hidden">
            {row.origin}
          </span>
        )}
      </button>

      {!isButler && (
        <button
          className="icon-btn absolute right-1.5 !h-6 !w-6 opacity-0 transition-opacity hover:!text-bad hover:bg-bad/10 group-hover:opacity-100"
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
  const { theme, toggle } = useTheme()
  const { live } = useStream()

  const { butler, tasks } = useMemo(() => {
    const inWs = sessions.filter((r) => normWorkspace(r.workspace) === workspace && !r.archived)
    const butlerRow = inWs.filter((r) => r.role === "butler").sort((a, b) => b.updatedAt - a.updatedAt)[0]
    return { butler: butlerRow, tasks: inWs.filter((r) => r.role !== "butler").sort((a, b) => b.updatedAt - a.updatedAt) }
  }, [sessions, workspace])

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

  const isButlerBusy = butler ? !!live.get(butler.sessionId)?.busy : false

  return (
    <aside className="flex w-60 flex-none flex-col border-r border-line bg-side">
      {/* Brand Header — Emo Ball in brand header, cute & lively, no ring */}
      <div className="flex flex-none items-center justify-between px-3.5 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <EmotionBall mood={isButlerBusy ? "thinking" : "idle"} size={26} lite hasRing={false} />
          <span className="text-sm font-semibold tracking-tight text-fg">newhorse</span>
        </div>
        <button
          className="icon-btn !h-7 !w-7"
          title={theme === "dark" ? "切换为明亮主题" : "切换为暗色主题"}
          onClick={toggle}
        >
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>

      {workspace && (
        <div className="flex-none truncate px-3.5 pb-1 text-2xs text-ghost" title={workspace}>
          {workspace}
        </div>
      )}

      {/* New Task Button */}
      <div className="flex-none px-3 pb-2.5 pt-1">
        <button className="btn btn-primary w-full justify-center shadow-sm" onClick={newTask}>
          <Plus size={14} /> 新任务
        </button>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 space-y-1">
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

        {tasks.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {tasks.map((r) => (
              <Row key={r.sessionId} row={r} selected={selectedId === r.sessionId} onDeleteDone={onDeleted} />
            ))}
          </div>
        )}

        {!sessionsLoading && !sessionsError && tasks.length === 0 && !butler && (
          <div className="px-3 py-6 text-center text-xs text-faint">
            暂无会话
            <br />
            点击「新任务」开始
          </div>
        )}
      </div>
    </aside>
  )
}
