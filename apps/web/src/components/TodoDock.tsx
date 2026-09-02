/**
 * Todo dock — sits above the composer (opencode placement). Folded from
 * Session.TodoUpdated events (never rendered inline in the transcript), with
 * the goal budget bar (goal × DAG × todo 四层): used / budget / status.
 * DAG-projected todos carry the "来自编排" note (pre-review §1.5①).
 */
import { useState } from "react"
import { CheckCircle2, ChevronRight, Circle, CircleDashed, CircleDot, ListChecks, Target } from "lucide-react"
import type { GoalView, TodoItem } from "../api/types"

export function TodoDock({ todos, goal }: { todos: TodoItem[]; goal: GoalView | null }): React.ReactElement | null {
  const [open, setOpen] = useState(true)
  if (todos.length === 0 && !goal) return null
  const done = todos.filter((t) => t.status === "completed").length
  return (
    <div className="card overflow-hidden">
      {goal && <GoalBar goal={goal} />}
      {todos.length > 0 && (
        <>
          <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover">
            <ListChecks size={13} className="flex-none text-dim" />
            <span className="text-xs font-medium text-fg">任务清单</span>
            <span className="font-mono text-2xs text-faint">
              {done}/{todos.length}
            </span>
            <ChevronRight size={12} className="ml-auto text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
          </button>
          {open && (
            <div className="border-t border-line px-3 py-1.5">
              {todos.map((t, i) => (
                <div key={i} className="flex items-start gap-2 py-1">
                  {t.status === "completed" ? (
                    <CheckCircle2 size={13} className="mt-0.5 flex-none text-ok" />
                  ) : t.status === "in_progress" ? (
                    <CircleDot size={13} className="mt-0.5 flex-none text-warn" />
                  ) : t.status === "cancelled" ? (
                    <CircleDashed size={13} className="mt-0.5 flex-none text-ghost" />
                  ) : (
                    <Circle size={13} className="mt-0.5 flex-none text-ghost" />
                  )}
                  <span className={`text-xs leading-relaxed ${t.status === "completed" ? "text-faint line-through" : t.status === "cancelled" ? "text-ghost line-through" : t.status === "in_progress" ? "text-fg" : "text-dim"}`}>
                    {t.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GoalBar({ goal }: { goal: GoalView }): React.ReactElement {
  const ratio = goal.tokenBudget ? (goal.tokensUsed ?? 0) / goal.tokenBudget : 0
  const statusText: Record<string, string> = { active: "进行中", paused: "已暂停", blocked: "受阻", complete: "已完成" }
  return (
    <div className="border-b border-line px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Target size={13} className="flex-none text-faint" />
        <span className="flex-1 truncate text-xs font-medium text-fg">{goal.objective}</span>
        <span className="chip !py-0 !text-[10px]">{statusText[goal.status] ?? goal.status}</span>
      </div>
      {goal.tokenBudget ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg2">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio > 0.85 ? "var(--bad)" : ratio > 0.6 ? "var(--warn)" : "var(--txt-ghost)" }}
            />
          </div>
          <span className="flex-none font-mono text-2xs text-faint">
            {Math.round((goal.tokensUsed ?? 0) / 1000)}k / {Math.round(goal.tokenBudget / 1000)}k
          </span>
        </div>
      ) : null}
    </div>
  )
}
