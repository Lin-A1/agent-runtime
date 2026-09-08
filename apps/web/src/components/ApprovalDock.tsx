import { useCallback, useEffect, useRef, useState, type ReactElement } from "react"
import { ChevronDown, ChevronUp, HelpCircle, X } from "lucide-react"
import { api } from "../api/client"

/**
 * ApprovalDock — the interactive surface for mid-turn requests from the
 * engine's approval hub: execpolicy gates AND ask_user questions. Polls
 * GET /v1/approvals (lightweight, 2.5s) and renders the oldest pending item
 * as a dock above the composer — a question shows option buttons + a free-form
 * answer; a command gate shows allow / deny.
 *
 * Auto-deny after the hub timeout (2min) means an unanswered dock degrades
 * gracefully — the turn NEVER hangs on a missing UI.
 */

interface PendingItem {
  id: string
  kind: "command" | "path" | "mode" | "question"
  target: string
  options?: readonly string[]
  sessionId?: string
  createdAt: number
  expiresAt: number
}

export function ApprovalDock({ hidden, sessionId, onPendingCount }: { hidden?: boolean; sessionId?: string; onPendingCount?: (n: number) => void }): ReactElement {
  const [items, setItems] = useState<PendingItem[]>([])
  const [answer, setAnswer] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const poll = useCallback((): void => {
    if (hidden) return
    void api
      .approvals()
      .then((r) => {
        const list = (r.approvals ?? []) as PendingItem[]
        setItems(list)
        onPendingCount?.(list.length)
      })
      .catch(() => {})
  }, [hidden, onPendingCount])

  useEffect(() => {
    poll()
    const timer = setInterval(poll, 2500)
    return () => clearInterval(timer)
  }, [poll])

  // Reset the answer box when the question changes.
  const current = items[0]
  const lastId = useRef<string | null>(null)
  useEffect(() => {
    if (current?.id !== lastId.current) {
      lastId.current = current?.id ?? null
      setAnswer("")
      setMinimized(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [current?.id])

  const settle = (allow: boolean, reply?: string): void => {
    if (!current) return
    setBusyId(current.id)
    void api
      .approve(current.id, allow, reply)
      .catch(() => {})
      .finally(() => {
        setBusyId(null)
        setAnswer("")
        poll()
      })
  }

  if (hidden || !current || minimized) {
    return hidden || !current ? <></> : (
      <button
        type="button"
        className="mb-1 flex w-full items-center justify-between rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-left text-xs text-fg"
        onClick={() => setMinimized(false)}
      >
        <span className="flex items-center gap-2">
          <HelpCircle size={14} className="text-warn" />
          有 1 个待回答的问题
        </span>
        <ChevronUp size={14} className="text-faint" />
      </button>
    )
  }

  const isQuestion = current.kind === "question"
  const isMine = !sessionId || current.sessionId === sessionId

  return (
    <div className="mb-1 rounded-xl border border-warn/40 bg-panel shadow-overlay" role="dialog" aria-label="待回答问题">
      <div className="flex items-center justify-between border-b border-line/50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-2xs font-medium text-warn">
          <HelpCircle size={12} />
          {isQuestion ? "Agent 需要你的回答" : "需要批准"}
          {!isMine && <span className="font-mono text-faint">· 来自其他会话</span>}
        </span>
        <button type="button" className="icon-btn !h-5 !w-5" aria-label="暂时收起" title="收起（稍后在原地恢复）" onClick={() => setMinimized(true)}>
          <ChevronDown size={12} />
        </button>
      </div>

      <div className="px-3 py-2.5">
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg">{current.target}</p>

        {isQuestion && current.options && current.options.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {current.options.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={busyId === current.id}
                className="rounded-lg border border-line bg-field px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-accent hover:bg-hover-2 disabled:opacity-50"
                onClick={() => settle(true, opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && answer.trim()) {
                e.preventDefault()
                settle(true, answer.trim())
              }
            }}
            placeholder={isQuestion ? "或输入你的回答…（Enter 发送）" : "备注（可选）…"}
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg2 px-2.5 py-1.5 text-xs text-fg placeholder:text-faint"
          />
          <button
            type="button"
            disabled={busyId === current.id || (isQuestion && !answer.trim())}
            className="flex-none rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            onClick={() => settle(true, answer.trim() || undefined)}
          >
            发送
          </button>
          <button
            type="button"
            disabled={busyId === current.id}
            className="icon-btn !h-7 !w-7 flex-none text-faint hover:text-bad"
            aria-label={isQuestion ? "不作答（按假设继续）" : "拒绝"}
            title={isQuestion ? "不作答——agent 会按保守假设继续" : "拒绝"}
            onClick={() => settle(false)}
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
