import { useEffect, useRef, useState, type ReactElement } from "react"
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  LockKeyhole,
  MessageCircleQuestion,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react"
import { api } from "../api/client"
import { useParams } from "react-router-dom"
import type { ApprovalRequest } from "../api/types"
import { useApp } from "../state/store"

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "无自动关闭时间"
  if (seconds <= 0) return "即将自动关闭"
  return `${seconds}s 后自动处理`
}

function requestLabel(request: ApprovalRequest): string {
  if (request.kind === "question") return "需要你的回答"
  if (request.kind === "path") return "请求访问路径"
  if (request.kind === "mode") return "请求切换模式"
  return "请求执行命令"
}

function requestScope(request: ApprovalRequest, sessions: Array<{ sessionId: string; title?: string }>): string {
  if (request.sessionId) {
    const row = sessions.find((s) => s.sessionId === request.sessionId)
    const name = row ? (row.title ? row.title.slice(0, 24) : request.sessionId.slice(0, 8)) : request.sessionId.slice(0, 8)
    return `${name}${request.tool ? ` · ${request.tool}` : ""}`
  }
  return "全局待处理请求"
}

export function ApprovalDock({ hidden = false, onPendingCount, focusRequest = 0 }: { hidden?: boolean; onPendingCount?: (count: number) => void; focusRequest?: number }): ReactElement | null {
  const { id: currentSessionId } = useParams()
  const { sessions } = useApp()
  const [pending, setPending] = useState<ApprovalRequest[]>([])
  const [idx, setIdx] = useState(0)
  const [reply, setReply] = useState("")
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const inFlight = useRef(false)
  useEffect(() => { onPendingCount?.(pending.length) }, [pending.length, onPendingCount])
  useEffect(() => {
    if (hidden || !focusRequest) return
    // Run after the drawer releases its focus trap and restores the trigger.
    const frame = requestAnimationFrame(() => panelRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [hidden, focusRequest])

  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const response = await api.approvals()
        if (alive) setPending(response.approvals)
      } catch {
        // Approval UI is non-blocking; the engine's timeout remains fail-closed.
      }
    }
    const start = (): ReturnType<typeof setInterval> => {
      void poll()
      return setInterval(() => void poll(), 2500)
    }
    let timer: ReturnType<typeof setInterval> | null = start()
    const onVisibility = (): void => {
      if (document.hidden) {
        if (timer) clearInterval(timer)
        timer = null
        return
      }
      timer = timer ?? start()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      alive = false
      document.removeEventListener("visibilitychange", onVisibility)
      if (timer) clearInterval(timer)
    }
  }, [])

  const visiblePending = pending
  const current = visiblePending.length ? visiblePending[idx % visiblePending.length] : undefined
  const isQuestion = current?.kind === "question"
  const expiresIn = current?.expiresAt ? Math.max(0, Math.round((current.expiresAt - now) / 1000)) : null

  useEffect(() => {
    if (!pending.length) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending.length])

  useEffect(() => {
    setReply("")
    setSelectedOption(null)
    setNotice(null)
  }, [current?.id])

  useEffect(() => {
    if (!isQuestion || hidden) return
    const active = document.activeElement
    const editable = active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
    if (!editable) inputRef.current?.focus()
  }, [current?.id, isQuestion, hidden])

  const settle = async (allow: boolean, answer?: string): Promise<void> => {
    if (!current || inFlight.current) return
    inFlight.current = true
    setSettling(true)
    try {
      const response = await api.approve(current.id, allow, answer)
      if (response?.settled === false) {
        setNotice("该请求已自动关闭，这次选择没有被采纳")
        setReply("")
        setSelectedOption(null)
      } else {
        const next = await api.approvals()
        setPending(next.approvals)
      }
    } catch {
      setNotice("提交失败，请检查连接后重试")
    } finally {
      inFlight.current = false
      setSettling(false)
      inputRef.current?.focus()
    }
  }

  if (!current || hidden) return null

  const chooseOption = (option: string): void => {
    setSelectedOption(option)
    setReply("")
  }

  const confirmQuestion = (): void => {
    const answer = selectedOption ?? reply.trim()
    if (answer) void settle(true, answer)
  }

  return (
    <div className="approval-layer" aria-live="polite">
      <section ref={panelRef} tabIndex={-1} className={`approval-panel ${expiresIn !== null && expiresIn <= 15 ? "is-expiring" : ""}`} role="dialog" aria-modal="false" aria-label={isQuestion ? "交互问答" : "执行审批"}>
        <header className="approval-header">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`approval-header-icon ${isQuestion ? "is-question" : "is-permission"}`}>{isQuestion ? <MessageCircleQuestion size={15} /> : <ShieldAlert size={15} />}</span>
            <div className="min-w-0"><p className="truncate text-xs font-semibold text-fg">{requestLabel(current)}</p><p className="truncate text-[10px] text-ghost">{!current.sessionId ? "全局" : current.sessionId === currentSessionId ? "当前会话" : "其他会话"} · {requestScope(current, sessions)}{current.callId ? ` · call ${current.callId.slice(0, 8)}` : ""}</p><p className="truncate text-[10px] text-ghost">{current.reason ?? (isQuestion ? "agent 正在等待你的决定" : "此操作需要通过当前审批策略")}</p></div>
          </div>
          <div className="flex flex-none items-center gap-2 font-mono text-[10px] text-ghost">
            {visiblePending.length > 1 && <><button type="button" className="approval-nav" title="上一条请求" aria-label="上一条请求" onClick={() => setIdx((value) => (value - 1 + visiblePending.length) % visiblePending.length)}><ChevronLeft size={12} /></button><span>{(idx % visiblePending.length) + 1}/{visiblePending.length}</span><button type="button" className="approval-nav" title="下一条请求" aria-label="下一条请求" onClick={() => setIdx((value) => (value + 1) % visiblePending.length)}><ChevronRight size={12} /></button></>}
            {expiresIn !== null && <span className={expiresIn <= 15 ? "text-warn" : ""}><Clock3 size={11} className="mr-1 inline" />{formatSeconds(expiresIn)}</span>}
          </div>
        </header>

        <div className="approval-body">
          {isQuestion ? (
            <>
              <div className="approval-question"><CircleHelp size={14} className="mt-0.5 flex-none text-accent" /><p>{current.target}</p></div>
              {current.options && current.options.length > 0 && <div className="approval-options" role="listbox" aria-label="可选回答">{current.options.map((option, optionIndex) => <button key={option} type="button" role="option" aria-selected={selectedOption === option} disabled={settling} className={`approval-option ${selectedOption === option ? "is-selected" : ""}`} onClick={() => chooseOption(option)}><span className="approval-option-key">{optionIndex + 1}</span><span className="min-w-0 flex-1 text-left">{option}</span>{selectedOption === option && <Check size={14} className="flex-none text-accent" />}</button>)}</div>}
              <div className="approval-answer-row"><input ref={inputRef} aria-label="自定义回答" value={reply} onChange={(event) => { setReply(event.target.value); setSelectedOption(null) }} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.code.startsWith("Digit")) { const option = current.options?.[Number(event.code.slice(5)) - 1]; if (option) { chooseOption(option); return } } if (event.key === "Enter" && (selectedOption || reply.trim())) confirmQuestion(); if (event.key === "Escape") void settle(false) }} placeholder={selectedOption ? `已选择“${selectedOption}”` : "输入自定义回答…"} className="approval-answer-input" /><button type="button" className="approval-confirm" disabled={settling || (!selectedOption && !reply.trim())} onClick={confirmQuestion}><Send size={13} />确认回答</button></div>
            </>
          ) : (
            <>
              <div className="approval-target-label"><LockKeyhole size={12} />执行内容</div>
              <pre className="approval-target">{current.target}</pre>
              <div className="approval-risk"><AlertTriangle size={13} className="flex-none text-warn" /><span>这项操作会使用当前 session 的权限和工作区边界。</span>{current.decision && <code>{current.decision}</code>}</div>
            </>
          )}
          {notice && <div className="approval-notice"><X size={13} />{notice}</div>}
        </div>

        <footer className="approval-footer">
          {isQuestion ? <><span className="approval-footer-hint">Esc 跳过，agent 会按默认策略继续</span><button type="button" className="approval-skip" disabled={settling} onClick={() => void settle(false)}>跳过</button></> : <><span className="approval-footer-hint">拒绝会让 agent 收到明确的执行失败结果</span><button type="button" className="approval-deny" disabled={settling} onClick={() => void settle(false)}>拒绝</button><button type="button" className="approval-allow" disabled={settling || expiresIn === 0} onClick={() => void settle(true)}><ShieldCheck size={13} />允许执行</button></>}
        </footer>
      </section>
    </div>
  )
}
