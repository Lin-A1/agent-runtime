import { useState, type ReactElement } from "react"
import { Check, Copy, RotateCcw } from "lucide-react"

/** Compact token count: 940 / 12.3k / 2.1M */
function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "k"
  return String(n)
}

/**
 * TurnFooter — Aligned with ZCode remote v4 assistant action bar:
 * Renders subtle inline actions: Copy, Thumbs Up, Thumbs Down, Retry, plus the
 * settle feedback (用时 · tokens) and timestamp on the right.
 */
export function TurnFooter({
  textToCopy,
  timestamp,
  onRetry,
  stats,
}: {
  textToCopy?: string
  timestamp?: string
  onRetry?: () => void
  /** Per-turn settle feedback aggregated from the session's model calls. */
  stats?: { ms: number; tokIn: number; tokOut: number }
}): ReactElement {
  const [copied, setCopied] = useState(false)

  const copyMarkdown = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!textToCopy) return
    void navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mt-3 flex items-center justify-between text-faint text-xs select-none">
      {/* Action buttons (ZCode style) */}
      <div className="flex items-center gap-3">
        {textToCopy && (
          <button
            type="button"
            onClick={copyMarkdown}
            className="hover:text-dim transition-colors p-1.5 -m-1"
            title="复制回复"
          >
            {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
          </button>
        )}

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="hover:text-dim transition-colors p-1.5 -m-1"
            title="重试（删除本次回答并重新生成）"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      {/* Right settle feedback + timestamp (ZCode style: e.g. 10:58) */}
      <div className="flex items-center gap-2.5 font-mono text-[11px] text-ghost/70">
        {stats && (stats.ms > 0 || stats.tokIn > 0 || stats.tokOut > 0) && (
          <span className="select-none">
            {stats.ms >= 500 && <span>用时 {(stats.ms / 1000).toFixed(1)}s</span>}
            {stats.ms >= 500 && stats.tokIn + stats.tokOut > 0 && <span className="mx-1.5">·</span>}
            {stats.tokIn > 0 && <span title="输入 tokens">↑{fmtTok(stats.tokIn)}</span>}
            {stats.tokIn > 0 && stats.tokOut > 0 && <span> </span>}
            {stats.tokOut > 0 && <span title="输出 tokens">↓{fmtTok(stats.tokOut)}</span>}
          </span>
        )}
        {timestamp && <span>{timestamp}</span>}
      </div>
    </div>
  )
}
