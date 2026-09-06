import type { ReactElement } from "react"
import { useNavigate } from "react-router-dom"

/**
 * BrandWordmark — Modern geometric developer-tool identity for newhorse:
 * Replaces the duplicate Emo Ball in the sidebar header, referencing
 * OpenCode / Linear geometric aesthetics. Features a precision faceted
 * origami knight monogram paired with tracked dual-tone typography.
 */
export function BrandWordmark({
  size = "md",
  showLabel = true,
  onClick,
  className = "",
}: {
  size?: "sm" | "md" | "lg"
  showLabel?: boolean
  onClick?: () => void
  className?: string
}): ReactElement {
  const navigate = useNavigate()
  const iconSize = size === "sm" ? 18 : size === "lg" ? 26 : 22

  const handleClick = (): void => {
    if (onClick) onClick()
    else navigate("/")
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          handleClick()
        }
      }}
      className={`inline-flex items-center gap-2 select-none cursor-pointer group ${className}`}
      title="返回主页"
    >
      {/* Precision Faceted Knight / Origami Monogram */}
      <div
        className="relative flex items-center justify-center rounded-lg border border-line bg-gradient-to-b from-panel to-bg2 p-1 shadow-sm transition-transform group-hover:scale-105"
        style={{ width: iconSize + 8, height: iconSize + 8 }}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-fg"
        >
          {/* Faceted Origami Knight: sharp geometric planes with subtle opacity contrast */}
          <path
            d="M5 20L6.5 13L10 9L14 7L18 8L19 11L16 13L18 20H5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            className="text-fg"
          />
          {/* Muzzle angle */}
          <path
            d="M14 7L11 3L9 5L10 9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fg"
          />
          {/* Inner facet crease */}
          <path
            d="M10 9L14 13L11 20"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeDasharray="1 1"
            className="text-faint opacity-60"
          />
          {/* Cybernetic eye node */}
          <circle cx="15.5" cy="9.5" r="1" fill="currentColor" className="text-accent" />
        </svg>
      </div>

      {/* Stylized Typographic Wordmark */}
      {showLabel && (
        <div className="flex items-baseline gap-1">
          <span
            className={`font-mono tracking-tight font-bold text-fg ${
              size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm"
            }`}
          >
            new<span className="font-sans font-light text-dim tracking-normal">horse</span>
          </span>
          <span className="text-[10px] font-mono font-medium text-ghost uppercase tracking-wider">v2</span>
        </div>
      )}
    </div>
  )
}
