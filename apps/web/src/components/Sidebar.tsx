/**
 * Sidebar — minimal, polished session list:
 * - Brand header with clean Newhorse mark & theme toggle (no duplicate emo ball)
 * - Pinned resident butler ("newhorse") with ambient status
 * - Task sessions with smooth hover affordance
 * - Non-destructive popover deletion (clean confirmation card, no layout shift)
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertCircle, Moon, Plus, Sun, Trash2, X } from "lucide-react"
import { api } from "../api/client"
import { prettyTitle } from "../api/fold"
import type { SessionRow } from "../api/types"
import { useApp, useStream } from "../state/store"
import { normWorkspace } from "../lib/workspace"
import { useTheme } from "../lib/theme"
import { Spinner } from "./ui"

function statusCls(row: SessionRow, busy: boolean): string {
  if (busy || row.status === "active") return "dot-active"
  if (row.status === "interrupted") return "dot-error"
  return "dot-settled"
}

/** Pure vector mark for newhorse: orbital planetoid ring + geometric crest */
function NewhorseBrandLogo({ className = "w-5 h-5" }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="nhLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="60%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>
      {/* Planetary Orbit Ring */}
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="4.5"
        transform="rotate(-24 16 16)"
        stroke="url(#nhLogoGrad)"
        strokeWidth="1.6"
        strokeDasharray="28 4 6 4"
        opacity="0.85"
      />
      {/* Core Planetoid / Crest */}
      <circle cx="16" cy="16" r="7.5" fill="currentColor" className="text-fg" opacity="0.92" />
      <circle cx="13.5" cy="13.5" r="2" fill="#ffffff" opacity="0.75" />
    </svg>
  )
}

function Row({ row, selected, onDeleteDone }: { row: SessionRow; selected: boolean; onDeleteDone: (deletedId: string) => void }): React.ReactElement {
  const navigate = useNavigate()
  const { live } = useStream()
  const { refreshSessions } = useApp()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const busy = !!live.get(row.sessionId)?.busy
  const isButler = row.role === "butler"

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!confirming) return
    const onDown = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setConfirming(false)
        setError(null)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setConfirming(false)
        setError(null)
      }
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [confirming])

  const doDelete = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setDeleting(true)
    setError(null)
    void api
      .deleteSession(row.sessionId)
      .then(() => {
        setConfirming(false)
        setDeleting(false)
        refreshSessions()
        onDeleteDone(row.sessionId)
      })
      .catch((err) => {
        setDeleting(false)
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  return (
    <div className="group relative">
      <button
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 pr-7 text-left text-xs transition-colors ${
          selected ? "bg-hover-2 text-fg font-medium" : "text-dim hover:bg-hover hover:text-fg"
        }`}
        onClick={() => navigate(`/s/${row.sessionId}`)}
      >
        {isButler ? (
          <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full bg-accent/20 text-accent ring-1 ring-accent/30" title="常驻管家会话">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        ) : (
          <span className={`dot flex-none ${statusCls(row, busy)}`} />
        )}
        <span className="min-w-0 flex-1 truncate">{isButler ? "newhorse" : prettyTitle(row.title, "未命名会话")}</span>
        {isButler && <span className="flex-none rounded bg-hover px-1 py-0.2 text-2xs text-accent">管家</span>}
        {row.origin && <span className="flex-none rounded border border-line px-1 text-2xs uppercase text-ghost group-hover:hidden">{row.origin}</span>}
      </button>

      {!isButler && (
        <button
          className={`icon-btn absolute right-1.5 top-1/2 !h-6 !w-6 -translate-y-1/2 transition-all ${
            confirming ? "opacity-100 !text-bad bg-hover" : "opacity-0 hover:!text-bad group-hover:opacity-100"
          }`}
          title="删除会话"
          onClick={(e) => {
            e.stopPropagation()
            setConfirming((v) => !v)
          }}
        >
          <Trash2 size={12} />
        </button>
      )}

      {/* Floating confirmation popover (Linear-style: no layout jump) */}
      {confirming && (
        <div
          ref={popoverRef}
          className="pop-in absolute right-1 top-full z-40 mt-1 w-56 rounded-xl border border-line-strong bg-panel/95 p-3 shadow-overlay backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-2">
            <div className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-bad/15 text-bad">
              <AlertCircle size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-fg">确认删除会话？</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-faint">删除后将从数据库彻底物理抹除，不可恢复。</p>
              {error && <p className="mt-1 text-2xs text-bad">{error}</p>}
            </div>
            <button
              className="icon-btn !h-5 !w-5 text-ghost hover:text-fg"
              onClick={() => {
                setConfirming(false)
                setError(null)
              }}
              title="取消"
            >
              <X size={12} />
            </button>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-line pt-2">
            <button
              className="btn !px-2.5 !py-1 !text-2xs"
              onClick={() => {
                setConfirming(false)
                setError(null)
              }}
            >
              取消
            </button>
            <button
              className="btn btn-danger !px-2.5 !py-1 !text-2xs"
              disabled={deleting}
              onClick={doDelete}
            >
              {deleting ? <Spinner size={11} /> : "确认删除"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ selectedId }: { selectedId?: string }): React.ReactElement {
  const navigate = useNavigate()
  const { sessions, sessionsLoading, sessionsError, refreshSessions, workspace } = useApp()
  const { theme, toggle } = useTheme()

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

  return (
    <aside className="flex w-64 flex-none flex-col border-r border-line bg-side">
      {/* Brand Header — clean Newhorse icon + typography + theme toggle */}
      <div className="flex flex-none items-center justify-between px-3.5 pb-1.5 pt-3.5">
        <div className="flex items-center gap-2">
          <NewhorseBrandLogo className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight text-fg">newhorse</span>
          <span className="rounded bg-hover px-1.5 py-0.5 text-2xs font-mono text-ghost">v2</span>
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
      <div className="flex-none px-3 pb-2 pt-1.5">
        <button className="btn btn-primary w-full justify-center shadow-sm" onClick={newTask}>
          <Plus size={14} /> 新任务
        </button>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sessionsLoading && (
          <div className="flex justify-center py-8">
            <Spinner size={15} />
          </div>
        )}
        {sessionsError && <div className="px-2 py-4 text-xs text-bad">{sessionsError}</div>}

        {butler && (
          <div className="mb-2">
            <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-ghost">常驻助手</div>
            <Row row={butler} selected={selectedId === butler.sessionId} onDeleteDone={onDeleted} />
          </div>
        )}

        {tasks.length > 0 && (
          <div>
            <div className="px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wider text-ghost">会话历史</div>
            <div className="flex flex-col gap-0.5">
              {tasks.map((r) => (
                <Row key={r.sessionId} row={r} selected={selectedId === r.sessionId} onDeleteDone={onDeleted} />
              ))}
            </div>
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
