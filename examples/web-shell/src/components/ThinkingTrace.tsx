import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react"
import { Check, Copy } from "lucide-react"

function extractSubgoal(rawText: string): string | null {
  if (!rawText) return null
  const headerMatch = rawText.match(/^(?:#{1,4}\s+|\*\*)([^\n*]+)/m)
  if (headerMatch && headerMatch[1]) {
    const clean = headerMatch[1].trim()
    return clean.length > 32 ? clean.slice(0, 30) + "…" : clean
  }
  return null
}

/**
 * ThinkingTrace — Full authentic port from BeautifulUI thinking.tsx:
 * Features the signature starburst icon, live shimmer gradient text,
 * adaptive vertical connecting rail, and smooth grid-interpolated reasoning foldout.
 */
export function ThinkingTrace({
  text,
  live = false,
}: {
  text: string
  live?: boolean
}): ReactElement {
  const [open, setOpen] = useState(live)
  const [copied, setCopied] = useState(false)
  const startTimeRef = useRef(Date.now())
  const [elapsed, setElapsed] = useState("0.0s")
  const [settledSec, setSettledSec] = useState<number | null>(null)
  const traceRef = useRef<HTMLDivElement>(null)
  const [lineHeight, setLineHeight] = useState(0)

  const subgoal = extractSubgoal(text)

  // Realtime stopwatch while live thinking is active
  useEffect(() => {
    if (!live) return
    const started = Date.now()
    startTimeRef.current = started
    const timer = setInterval(() => {
      const s = ((Date.now() - started) / 1000).toFixed(1)
      setElapsed(`${s}s`)
    }, 100)
    return () => {
      clearInterval(timer)
      const finalSec = (Date.now() - started) / 1000
      setSettledSec(finalSec)
    }
  }, [live])

  // Keep auto-open while live
  useEffect(() => {
    if (live) setOpen(true)
  }, [live])

  useLayoutEffect(() => {
    if (traceRef.current) {
      setLineHeight(traceRef.current.offsetHeight)
    }
  }, [open, text])

  const copyText = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex w-full flex-col my-1 min-w-0">
      {/* Header — BeautifulUI style */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2 select-none"
      >
        {/* Starburst icon from BeautifulUI */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={live ? "var(--ink-2)" : "var(--ink-3)"}
          className="flex-none"
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>

        {live ? (
          <span
            className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--ink-3) 30%, var(--ink) 50%, var(--ink-3) 70%)",
              backgroundSize: "200% 100%",
              animation: "shimmer-text 1.4s linear infinite",
            }}
          >
            思考中{subgoal ? ` · ${subgoal}` : ""} ({elapsed})
          </span>
        ) : (
          <span className="text-[13px] font-medium whitespace-nowrap text-ink-2">
            思考{settledSec !== null ? ` · 持续了 ${Math.max(1, Math.round(settledSec))} 秒` : ""}{subgoal ? ` · ${subgoal}` : ""}
          </span>
        )}

        {/* Chevron icon with smooth rotation */}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-300 flex-none ml-0.5"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Expandable trace with dynamic vertical rail line */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-0 pl-[26px]">
            {/* Dynamic height connecting rail line */}
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{
                top: 0,
                height: lineHeight ? Math.max(lineHeight - 4, 0) : 0,
                transition: "height 300ms cubic-bezier(0.23, 1, 0.32, 1)",
              }}
            />

            <div ref={traceRef} className="group/trace relative py-1">
              {/* Boxless rail content (ZCode thinking style): plain dim text
                  on the shared left rail; copy reveals on hover */}
              <button
                type="button"
                onClick={copyText}
                className="pointer-events-none absolute right-0 top-1 flex items-center gap-1 rounded-chip bg-field px-1.5 py-0.5 text-[11px] text-ink-3 opacity-0 shadow-hairline transition-opacity duration-150 hover:text-ink group-hover/trace:pointer-events-auto group-hover/trace:opacity-100"
                title="复制思考过程"
              >
                {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                <span>{copied ? "已复制" : "复制"}</span>
              </button>

              <div className="select-text whitespace-pre-wrap break-words pr-10 text-[12.5px] leading-[1.75] text-faint">
                {text}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
