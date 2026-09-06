import { useEffect, useState, type ReactElement } from "react"

// BeautifulUI 3x3 pixel matrix wavefront pattern (Drive variant)
const CHEVRON_DELAYS = [0, 90, 180, 90, 180, 270, 180, 270, 360]

/**
 * PixelLoader — Ported directly from BeautifulUI loading-state.tsx:
 * Renders a 3x3 pixel matrix wavefront paired with an elapsed stopwatch timer
 * and shimmer text for long-running agent work.
 */
export function PixelLoader({
  label = "Agent 正在执行",
  showTimer = true,
  className = "",
}: {
  label?: string
  /** Hide the built-in stopwatch when the caller already shows one. */
  showTimer?: boolean
  className?: string
}): ReactElement {
  const [ds, setDs] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100)
    return () => clearInterval(t)
  }, [])

  const totalSec = (ds / 10).toFixed(1)

  return (
    <div className={`inline-flex items-center gap-2 select-none font-mono ${className}`}>
      {/* 3x3 Matrix Grid — neutral foreground pulse (a saturated green dot
          reads murky at 3px; white-on-dark pulses clean) */}
      <span aria-hidden className="grid grid-cols-3 gap-[2px] w-[14px] h-[14px]">
        {CHEVRON_DELAYS.map((delay, i) => (
          <span
            key={i}
            className="w-[3px] h-[3px] rounded-[0.5px] bg-fg"
            style={{
              animation: `pixel-on 650ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>

      <span className="shimmer-text text-xs font-semibold">
        {label}
      </span>

      {showTimer && (
        <span className="text-2xs text-ghost tabular-nums">
          ({totalSec}s)
        </span>
      )}
    </div>
  )
}
