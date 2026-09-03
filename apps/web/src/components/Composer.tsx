/**
 * Composer — floating elevated dock for prompt input & steering:
 * - Listens for `nh-fill-prompt` events (starter pills in empty state)
 * - Elevated card with subtle border glow, backdrop blur and clean textarea
 * - Tactile send / interrupt button transition
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, CornerDownLeft, Loader2, Square } from "lucide-react"
import { useStream } from "../state/store"

export function Composer({ sessionId }: { sessionId: string }): React.ReactElement {
  const { send, stop, live } = useStream()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const busy = !!live.get(sessionId)?.busy

  // Autosize textarea
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "0px"
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`
  }, [text])

  // Reset text on session change
  useEffect(() => {
    setText("")
    setError(null)
  }, [sessionId])

  // Listen to starter prompt pills from empty state
  useEffect(() => {
    const onFill = (e: Event): void => {
      const custom = e as CustomEvent<string>
      if (custom.detail) {
        setText(custom.detail)
        requestAnimationFrame(() => {
          taRef.current?.focus()
        })
      }
    }
    window.addEventListener("nh-fill-prompt", onFill)
    return () => window.removeEventListener("nh-fill-prompt", onFill)
  }, [])

  const doSend = useCallback(
    async (raw: string) => {
      const body = raw.trim()
      if (!body || sending) return
      setSending(true)
      setText("")
      setError(null)
      try {
        await send(sessionId, body)
      } catch (err) {
        setText(body)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSending(false)
        taRef.current?.focus()
      }
    },
    [send, sessionId, sending],
  )

  return (
    <div className="flex-none px-4 pb-5 pt-2">
      <div className="mx-auto max-w-3xl">
        {error && <div className="mb-2 text-xs font-medium text-bad">{error}</div>}

        <div className="composer-elevated">
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder={busy ? "回合进行中 — 发送将作为追加指示 (steer)…" : "输入任务，向 newhorse 提问或派发指令…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void doSend(text)
              }
            }}
          />

          <div className="flex items-center justify-between px-3.5 pb-3 pt-1">
            <div className="flex items-center gap-1.5 text-2xs text-ghost">
              <CornerDownLeft size={11} className="opacity-70" />
              <span>Shift + Enter 换行 · Enter 发送</span>
            </div>

            <div className="flex items-center gap-2">
              {busy ? (
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bad text-white shadow-sm transition-all hover:bg-bad/90 hover:scale-105 active:scale-95"
                  title="中断当前回合"
                  onClick={() => void stop(sessionId)}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-on-accent shadow-sm transition-all hover:opacity-90 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:scale-100 disabled:cursor-not-allowed"
                  title="发送 (Enter)"
                  disabled={sending || !text.trim()}
                  onClick={() => void doSend(text)}
                >
                  {sending ? <Loader2 size={13} className="spin" /> : <ArrowUp size={14} strokeWidth={2.4} />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
