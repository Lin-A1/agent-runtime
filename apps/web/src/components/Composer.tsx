/**
 * Composer — minimal conversation input: text + send/stop. Idle submit runs
 * the prompt SSE stream; while a turn is live the same submit becomes a
 * steer, and the red square interrupts. Slash/@ menus, images and the model
 * chip return in Phase 2.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, Loader2, Square } from "lucide-react"
import { useStream } from "../state/store"

export function Composer({ sessionId }: { sessionId: string }): React.ReactElement {
  const { send, stop, live } = useStream()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const busy = !!live.get(sessionId)?.busy

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "0px"
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`
  }, [text])

  useEffect(() => {
    setText("")
    setError(null)
  }, [sessionId])

  const doSend = useCallback(
    async (raw: string) => {
      const body = raw.trim()
      if (!body || sending) return
      setSending(true)
      setError(null)
      try {
        await send(sessionId, body)
        setText("")
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSending(false)
        taRef.current?.focus()
      }
    },
    [send, sessionId, sending],
  )

  return (
    <div className="flex-none px-4 pb-4 pt-1">
      <div className="mx-auto max-w-3xl">
        {error && <div className="mb-1.5 text-xs text-bad">{error}</div>}
        <div className="composer">
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder={busy ? "回合进行中 — 发送将作为追加指令 (steer)…" : "输入任务开始对话"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void doSend(text)
              }
            }}
          />
          <div className="flex items-center px-2.5 pb-2">
            <div className="ml-auto">
              {busy ? (
                <button className="send-btn !bg-bad" title="中断当前回合" onClick={() => void stop(sessionId)}>
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button className="send-btn" title="发送 (Enter)" disabled={sending || !text.trim()} onClick={() => void doSend(text)}>
                  {sending ? <Loader2 size={13} className="spin" /> : <ArrowUp size={15} />}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="mt-1.5 text-center text-2xs text-ghost">Enter 发送 · Shift+Enter 换行</div>
      </div>
    </div>
  )
}
