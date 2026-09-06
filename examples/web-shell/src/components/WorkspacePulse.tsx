import { useEffect, useRef, useState, type ReactElement } from "react"
import { Activity, ChevronDown, CircleAlert, CircleCheck, CircleDot, Database, FileDiff, Gauge, ListChecks, PanelRight, ShieldCheck, Square, TerminalSquare, X } from "lucide-react"
import type { SessionActivity } from "../workbench/types"

function stateLabel(activity: SessionActivity): string {
  if (activity.state === "working") return "Agent 正在工作"
  if (activity.state === "error") return "最近回合失败"
  if (activity.state === "success") return "最近回合已完成"
  if (activity.state === "interrupted") return "回合已中断"
  if (activity.state === "waiting") return "等待你的决定"
  return "等待下一步"
}

function stateIcon(activity: SessionActivity): ReactElement {
  if (activity.state === "working") return <Activity size={13} className="spin" />
  if (activity.state === "error") return <CircleAlert size={13} />
  if (activity.state === "success") return <CircleCheck size={13} />
  return <CircleDot size={13} />
}

function policyLabel(policy: SessionActivity["policy"]): string {
  if (policy === "trusted") return "完全访问"
  if (policy === "readonly") return "只读模式"
  if (policy === "strict") return "严格审批"
  return "策略未知"
}

export function WorkspacePulse({ activity, wsName, workspace, open, onToggle, onOpenResource, onStop, onFocusComposer }: { activity: SessionActivity; wsName: string; workspace?: string; open: boolean; onToggle: () => void; onOpenResource: (tab: "terminal" | "files" | "activity" | "preview" | "context") => void; onStop?: () => void; onFocusComposer?: () => void }): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [lastOpen, setLastOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onToggle()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      onToggle()
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
    window.addEventListener("pointerdown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [onToggle, open])

  useEffect(() => {
    if (open && !lastOpen) panelRef.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus()
    setLastOpen(open)
  }, [lastOpen, open])

  const hasRunningTools = activity.tools.some((tool) => tool.state === "running")
  const done = activity.todos.filter((todo) => todo.status === "completed").length
  const activeTodo = activity.todos.find((todo) => todo.status === "in_progress")
  const contextRatio = activity.context?.ratio ?? (activity.context?.windowTokens ? activity.context.estTokens / activity.context.windowTokens : undefined)
  const accentClass = activity.state === "working" ? "is-working" : activity.state === "error" ? "is-error" : activity.state === "success" ? "is-success" : ""

  return <div className="workspace-pulse-layer">
    <button ref={triggerRef} type="button" className={`workspace-pulse-trigger ${open ? "is-open" : ""} ${accentClass}`} aria-expanded={open} aria-controls="workspace-pulse-panel" aria-label={open ? "收起工作区现场" : "展开工作区现场"} onClick={onToggle} title="工作区现场">
      <span className="workspace-pulse-trigger-icon">{stateIcon(activity)}</span><span className="workspace-pulse-trigger-copy"><strong>{stateLabel(activity)}</strong><small>{activity.summary}</small></span><ChevronDown size={13} className={open ? "rotate-180" : ""} />
    </button>
    {open && <aside ref={panelRef} id="workspace-pulse-panel" className="workspace-pulse-panel" role="dialog" aria-label="工作区现场">
      <header className="workspace-pulse-header"><div className="min-w-0"><p className="workspace-pulse-kicker">workspace pulse</p><h2>工作区现场</h2><p className="workspace-pulse-path" title={workspace}>{wsName || "workspace"}</p></div><button type="button" className="icon-btn !h-7 !w-7" aria-label="关闭工作区现场" title="关闭" onClick={() => { onToggle(); triggerRef.current?.focus() }}><X size={14} /></button></header>
      <div className="workspace-pulse-body">
        <section className={`workspace-pulse-now ${accentClass}`}><div className="workspace-pulse-now-icon">{stateIcon(activity)}</div><div className="min-w-0"><strong>{stateLabel(activity)}</strong><p>{activity.summary}</p></div><span className="workspace-pulse-evidence">{activity.evidence}</span></section>
        <div className="workspace-pulse-action-row">{activity.liveTurn?.busy && onStop && <button type="button" className="workspace-pulse-action is-danger" onClick={onStop}><Square size={12} fill="currentColor" />停止回合</button>}{onFocusComposer && <button type="button" className="workspace-pulse-action" onClick={onFocusComposer}>继续指示</button>}{hasRunningTools && <button type="button" className="workspace-pulse-action" onClick={() => onOpenResource("terminal")}><TerminalSquare size={12} />查看终端</button>}</div>
        <section className="workspace-pulse-grid"><button type="button" className="workspace-pulse-fact" onClick={() => onOpenResource("activity")}><FileDiff size={13} /><span><small>文件活动</small><strong>{activity.changes.length ? `${activity.changes.length} 个文件` : "暂无"}</strong></span></button><button type="button" className="workspace-pulse-fact" onClick={() => onOpenResource("context")}><ListChecks size={13} /><span><small>目标与计划</small><strong>{activity.todos.length ? `${done}/${activity.todos.length} 完成` : "未设置"}</strong></span></button><button type="button" className="workspace-pulse-fact" onClick={() => onOpenResource("context")}><Database size={13} /><span><small>上下文</small><strong>{contextRatio === undefined ? "未知" : `${Math.round(contextRatio * 100)}%`}</strong></span></button><button type="button" className="workspace-pulse-fact" onClick={() => onOpenResource("context")}><ShieldCheck size={13} /><span><small>执行策略</small><strong>{policyLabel(activity.policy)}</strong></span></button></section>
        {activity.goal && <section className="workspace-pulse-section"><div className="workspace-pulse-section-title"><CircleDot size={13} />当前目标</div><p>{activity.goal.objective}</p></section>}
        {activeTodo && <section className="workspace-pulse-section"><div className="workspace-pulse-section-title"><Gauge size={13} />正在推进</div><button type="button" className="workspace-pulse-todo" onClick={() => onOpenResource("context")}><span className="workspace-pulse-todo-marker" /><span>{activeTodo.activeForm ?? activeTodo.content}</span></button></section>}
        {activity.tools.length > 0 && <section className="workspace-pulse-section"><div className="workspace-pulse-section-title"><Activity size={13} />最近活动 <span>{activity.tools.length}</span></div><div className="workspace-pulse-activity-list">{activity.tools.slice(0, 4).map((tool, index) => <button type="button" key={`${tool.name}-${index}`} onClick={() => onOpenResource("terminal")}><span className={`workspace-pulse-tool-status is-${tool.state}`} /> <span>{tool.name}</span><code>{tool.summary}</code></button>)}</div></section>}
      </div>
      <footer className="workspace-pulse-footer"><span><PanelRight size={12} />右侧工作栏承载资源操作</span><span>source: session</span></footer>
    </aside>}
  </div>
}
