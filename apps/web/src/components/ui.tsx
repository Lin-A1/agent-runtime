/**
 * Shared UI primitives — neutral surfaces, white-alpha borders, tight radii,
 * 14px base (design tokens in index.css). No invented hues: semantic colors
 * come from the token table only.
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, ChevronDown, Loader2, RefreshCw, X } from "lucide-react"
import type { SessionStatus } from "../api/types"

// --- four-state blocks (loading / error / empty / work) ---

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }): React.ReactElement {
  return <Loader2 size={size} className={`spin ${className}`} />
}

export function LoadingState({ label = "加载中…", className = "" }: { label?: string; className?: string }): React.ReactElement {
  return (
    <div className={`flex items-center justify-center gap-2 py-16 text-faint ${className}`}>
      <Spinner size={15} />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry, className = "" }: { message: string; onRetry?: () => void; className?: string }): React.ReactElement {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-bg2 text-bad">
        <AlertTriangle size={18} />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">区域加载失败</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">{message}</p>
      </div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          <RefreshCw size={13} /> 重试
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, hint, action, className = "" }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode; className?: string }): React.ReactElement {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className}`}>
      {icon && <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-bg2 text-faint">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {hint && <p className="mt-1 max-w-sm text-xs leading-relaxed text-faint">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/** Standard region wrapper: picks one of the four states. */
export function AsyncRegion<T>({
  state,
  emptyIf,
  empty,
  children,
  className = "",
}: {
  state: { data: T | null; error: Error | null; loading: boolean; retry: () => void }
  emptyIf?: (d: T) => boolean
  empty: ReactNode
  children: (data: T) => ReactNode
  className?: string
}): React.ReactElement {
  if (state.loading) return <LoadingState className={className} />
  if (state.error) return <ErrorState className={className} message={state.error.message} onRetry={state.retry} />
  if (!state.data || (emptyIf && emptyIf(state.data))) return <div className={className}>{empty}</div>
  return <div className={className}>{children(state.data)}</div>
}

// --- atoms ---

export function StatusDot({ status, className = "" }: { status: SessionStatus | string; className?: string }): React.ReactElement {
  const cls = status === "active" ? "dot-active" : status === "interrupted" ? "dot-error" : "dot-settled"
  return <span className={`dot ${cls} ${className}`} />
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="relative h-[18px] w-[32px] flex-none rounded-full border transition-colors"
      style={{
        background: checked ? "var(--accent)" : "var(--bg2)",
        borderColor: checked ? "var(--accent)" : "var(--line-strong)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        className="absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all"
        style={{ left: checked ? 16 : 3 }}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: Array<{ value: T; label: ReactNode; title?: string }>
  value: T
  onChange?: (v: T) => void
  size?: "xs" | "sm"
}): React.ReactElement {
  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-bg2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange?.(o.value)}
          className={`rounded-md px-2.5 ${size === "xs" ? "py-0.5 text-2xs" : "py-1 text-xs"} transition-colors ${
            o.value === value ? "bg-hover-2 text-fg" : "text-faint hover:text-dim"
          }`}
          style={o.value === value ? { background: "var(--hover-2)" } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ ratio, tone = "accent", className = "" }: { ratio: number; tone?: "accent" | "warn" | "bad"; className?: string }): React.ReactElement {
  const color = tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--accent)"
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-bg2 ${className}`}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: color }}
      />
    </div>
  )
}

export function Modal({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }): React.ReactElement | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "var(--scrim)" }} onMouseDown={onClose}>
      <div
        className="card flex max-h-[85vh] w-full flex-col overflow-hidden shadow-overlay"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

export function Dropdown({ trigger, children, align = "left", width = 200 }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; width?: number }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])
  return (
    <div ref={ref} className="relative inline-flex">
      <div onClick={() => setOpen((v) => !v)} className="inline-flex cursor-pointer">
        {trigger}
      </div>
      {open && (
        <div
          className="menu absolute z-40 mt-1"
          style={{ [align === "right" ? "right" : "left"]: 0, top: "100%", width, minWidth: width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, disabled }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean }): React.ReactElement {
  return (
    <button className={`menu-item ${danger ? "danger" : ""}`} onClick={onClick} disabled={disabled} style={disabled ? { opacity: 0.45, cursor: "default" } : undefined}>
      {icon}
      <span>{children}</span>
    </button>
  )
}

export function Chevron({ open }: { open: boolean }): React.ReactElement {
  return <ChevronDown size={13} className="text-faint transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
}

/** Page header for standalone pages: title + optional actions, full width. */
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-6 py-4">
      <div>
        <h1 className="text-base font-semibold text-fg">{title}</h1>
        {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }): React.ReactElement {
  return <div className={`card ${pad ? "p-4" : ""} ${className}`}>{children}</div>
}

export function Label({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="label mb-2">{children}</div>
}
