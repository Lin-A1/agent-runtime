/**
 * StatusPopover — the 状态悬窗: a compact floating status window anchored to
 * the transcript header's 更改 pill (ZCode remote v4 pattern). Collapsed it is
 * just the pill; expanded it floats over the chat with the full
 * 更改 / 目标 / 计划 stack. All data folds from the same event log.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react"
import {
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  FileDiff,
  FileText,
  Loader2,
  Target,
} from "lucide-react"
import { foldGoal, foldTodos, type FileChange, type TranscriptItem } from "../api/fold"
import type { StoredEventRow } from "../api/types"

interface ChangeRow {
  path: string
  added: number
  removed: number
  touches: number
  diff: FileChange["diff"]
}

function aggregateChanges(items: TranscriptItem[]): ChangeRow[] {
  const map = new Map<string, ChangeRow>()
  for (const it of items) {
    if (it.kind !== "user") continue
    for (const c of it.changes) {
      const prev = map.get(c.path)
      map.set(c.path, {
        path: c.path,
        added: (prev?.added ?? 0) + c.added,
        removed: (prev?.removed ?? 0) + c.removed,
        touches: Math.max(prev?.touches ?? 0, c.touches),
        diff: c.diff.length > 0 ? c.diff : (prev?.diff ?? []),
      })
    }
  }
  return [...map.values()].sort((a, b) => b.touches - a.touches)
}

function extIcon(path: string): ReactElement {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  const color =
    ext === "json" || ext === "lock"
      ? "text-warn"
      : ext === "css"
      ? "text-trajreasoning"
      : ext === "md"
      ? "text-interactive"
      : ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx"
      ? "text-interactive"
      : "text-dim"
  return <FileText size={13} className={`flex-none ${color}`} />
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h > 0 ? `${h}小时` : ""}${m > 0 ? `${m}分` : ""}${h > 0 && m === 0 ? "" : `${sec}秒`}`
}

const GOAL_STATUS_ZH: Record<string, string> = {
  active: "进行中",
  in_progress: "进行中",
  pending: "等待中",
  paused: "已暂停",
  complete: "已完成",
  completed: "已完成",
  failed: "失败",
}

function Section({
  icon,
  label,
  meta,
  children,
}: {
  icon: ReactElement
  label: string
  meta?: ReactElement
  children: ReactNode
}): ReactElement {
  return (
    <section className="border-b border-line/60 px-3 py-2.5 last:border-b-0">
      <div className="mb-1.5 flex items-center gap-2 select-none">
        <span className="flex-none text-ghost">{icon}</span>
        <span className="flex-none text-xs font-medium text-fg">{label}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5">{meta}</span>
      </div>
      {children}
    </section>
  )
}

export function StatusPopover({
  open,
  onClose,
  events,
  items,
}: {
  open: boolean
  onClose: () => void
  events: StoredEventRow[] | null
  items: TranscriptItem[]
}): ReactElement | null {
  const goal = useMemo(() => (events ? foldGoal(events) : null), [events])
  const todos = useMemo(() => (events ? foldTodos(events) : []), [events])
  const changes = useMemo(() => aggregateChanges(items), [items])

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [showAllChanges, setShowAllChanges] = useState(false)
  const [showAllTodos, setShowAllTodos] = useState(false)
  const CAP = 10

  const goalDone = goal?.status === "complete" || goal?.status === "completed"
  const now = useTick(!!goal?.startedTs && !goalDone)
  // Done goals show the honest settled→started duration, not "start → open time".
  const goalElapsed = goal?.startedTs
    ? fmtDuration(goal.settledTs ? goal.settledTs - goal.startedTs : now - goal.startedTs)
    : null

  const done = todos.filter((t) => t.status === "completed").length
  const inProgress = todos.filter((t) => t.status === "in_progress").length
  const progress = todos.length > 0 ? Math.round((done / todos.length) * 100) : 0

  const sumAdded = changes.reduce((n, c) => n + c.added, 0)
  const sumRemoved = changes.reduce((n, c) => n + c.removed, 0)

  const ref = useRef<HTMLDivElement>(null)

  // Outside-pointerdown + Escape close; the anchor pill is excluded (its own
  // click toggles — closing here then re-toggling would flash the window).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement | null
      if (ref.current?.contains(t)) return
      if (t?.closest("[data-status-anchor]")) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("pointerdown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div ref={ref} className="pop-in absolute right-3 top-11 z-30 max-h-[68vh] w-[340px] overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel shadow-overlay">
      {/* 更改 */}
      <Section
        icon={<FileDiff size={13} />}
        label="更改"
        meta={
          changes.length > 0 ? (
            <span className="font-mono text-2xs">
              <span className="text-ok">+{sumAdded}</span> <span className="text-bad">−{sumRemoved}</span>
            </span>
          ) : (
            <span className="text-2xs text-ghost">无</span>
          )
        }
      >
        {changes.length === 0 ? (
          <p className="py-1 text-xs text-faint">会话内写入/编辑过的文件会汇总在这里</p>
        ) : (
          (showAllChanges ? changes : changes.slice(0, CAP)).map((c) => {
            const name = c.path.split(/[\\/]/).pop() ?? c.path
            const dir = c.path.slice(0, c.path.length - name.length)
            const isOpen = openPath === c.path
            return (
              <div key={c.path} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setOpenPath(isOpen ? null : c.path)}
                  className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors cursor-pointer hover:bg-hover ${
                    isOpen ? "bg-hover" : ""
                  }`}
                  title={c.path}
                >
                  {extIcon(c.path)}
                  <span className="min-w-0 max-w-[45%] flex-none truncate text-xs font-medium text-fg">{name}</span>
                  {dir && <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ghost">{dir}</span>}
                  <span className="ml-auto flex-none font-mono text-2xs tabular-nums">
                    <span className="inline-block w-8 text-right text-ok">{c.added > 0 ? `+${c.added}` : ""}</span>
                    <span className="inline-block w-8 text-right text-bad">{c.removed > 0 ? `-${c.removed}` : ""}</span>
                  </span>
                  <ChevronDown
                    size={12}
                    className={`flex-none text-ghost transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <div
                  className="grid transition-[grid-template-rows,opacity] duration-250 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", opacity: isOpen ? 1 : 0 }}
                >
                  <div className="overflow-hidden">
                    {isOpen && (
                      <div className="mb-1 ml-5 overflow-hidden rounded-md border border-line bg-inset">
                        {c.diff.length > 0 ? (
                          <div className="codeblock-body max-h-56 select-text overflow-y-auto py-1 text-2xs">
                            {c.diff.map((d, i) => (
                              <div key={i} className={`cline ${d.kind}`}>
                                <span className="whitespace-pre-wrap break-all">{d.text}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="px-3 py-2 text-2xs text-ghost">未留存此文件的 diff 数据</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </Section>

      {/* 目标 */}
      <Section
        icon={<Target size={13} />}
        label="目标"
        meta={
          goal ? (
            <span className="flex items-center gap-1.5 font-mono text-2xs text-faint tabular-nums">
              {goalDone ? (
                <>
                  <Check size={11} className="text-ok" />
                  {goalElapsed && <span>用时 {goalElapsed}</span>}
                </>
              ) : (
                <>
                  {goalElapsed && <span>{goalElapsed}</span>}
                  {goal.status && <span className="text-dim">{GOAL_STATUS_ZH[goal.status] ?? goal.status}</span>}
                </>
              )}
            </span>
          ) : (
            <span className="text-2xs text-ghost">无</span>
          )
        }
      >
        {goal ? (
          <p className="break-words rounded-lg border border-line bg-card/50 p-2.5 text-[13px] leading-relaxed text-dim select-text">
            {goal.objective}
          </p>
        ) : (
          <p className="py-1 text-xs text-faint">用 /goal 设置，回合目标会自动显示在这里</p>
        )}
      </Section>

      {/* 计划 */}
      <Section
        icon={<Loader2 size={13} className={inProgress > 0 ? "spin" : ""} />}
        label="计划"
        meta={
          todos.length > 0 ? (
            <span className="font-mono text-2xs text-faint tabular-nums">
              {done}/{todos.length}
            </span>
          ) : (
            <span className="text-2xs text-ghost">无</span>
          )
        }
      >
        {todos.length === 0 ? (
          <p className="py-1 text-xs text-faint">代理写下的 todo 清单会同步在这里</p>
        ) : (
          <>
            {todos.length > CAP && !showAllTodos && (
              <button
                type="button"
                className="mb-1 w-full rounded px-1.5 py-1 text-left text-2xs text-faint transition-colors hover:bg-hover hover:text-dim cursor-pointer"
                onClick={() => setShowAllTodos(true)}
              >
                展开全部 {todos.length} 项…
              </button>
            )}
            <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-ok/70 transition-[width] duration-300" style={{ width: `${progress}%` }} />
            </div>
            {(showAllTodos ? todos : todos.slice(0, CAP)).map((t, i) => (
              <div
                key={i}
                className={`relative flex items-start gap-2 rounded-md px-1.5 py-1.5 ${
                  t.status === "in_progress" ? "bg-hover/60" : ""
                }`}
              >
                {t.status === "in_progress" && (
                  <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-warn/70" aria-hidden />
                )}
                {t.status === "completed" ? (
                  <CircleCheck size={13} className="mt-0.5 flex-none text-ok" />
                ) : t.status === "in_progress" ? (
                  <Loader2 size={13} className="spin mt-0.5 flex-none text-warn" />
                ) : (
                  <Circle size={13} className="mt-0.5 flex-none text-ghost" />
                )}
                <span
                  className={`break-words text-xs leading-snug ${
                    t.status === "completed" ? "text-ghost line-through" : t.status === "in_progress" ? "text-fg" : "text-dim"
                  } select-text`}
                >
                  {t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
                </span>
              </div>
            ))}
          </>
        )}
      </Section>
    </div>
  )
}
