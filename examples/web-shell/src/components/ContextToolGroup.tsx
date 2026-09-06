import { useState, type ReactElement } from "react"
import { ChevronRight, FileText, FolderSearch, Globe, Search } from "lucide-react"
import type { ToolBlock } from "../api/fold"
import { Spinner } from "./ui"

export const CONTEXT_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "search",
  "web_search",
  "webfetch",
  "web_fetch",
  "file",
  "list_sessions",
])

export function isContextTool(name: string): boolean {
  return CONTEXT_TOOLS.has(name.toLowerCase())
}

function getContextIcon(name: string): ReactElement {
  const lc = name.toLowerCase()
  if (lc.includes("search") || lc.includes("web")) return <Globe size={12} />
  if (lc.includes("grep")) return <Search size={12} />
  if (lc.includes("read") || lc.includes("file")) return <FileText size={12} />
  return <FolderSearch size={12} />
}

/**
 * ContextToolGroup — consecutive read/grep/glob/list steps folded into one
 * quiet row that matches the ToolTrace row rhythm (28px, no box chrome).
 * Expands into compact mono child rows; each child expands its output inline.
 */
export function ContextToolGroup({
  tools,
  pending = false,
}: {
  tools: Array<Omit<ToolBlock, "summary"> & { summary?: string }>
  pending?: boolean
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  // Metrics computation
  let readCount = 0
  let searchCount = 0
  let otherCount = 0

  for (const t of tools) {
    const lc = t.name.toLowerCase()
    if (lc.includes("read") || lc.includes("file")) readCount++
    else if (lc.includes("search") || lc.includes("grep") || lc.includes("glob") || lc.includes("web")) searchCount++
    else otherCount++
  }

  const badges: string[] = []
  if (readCount > 0) badges.push(`${readCount} 个文件`)
  if (searchCount > 0) badges.push(`${searchCount} 次检索`)
  if (otherCount > 0) badges.push(`${otherCount} 项操作`)

  return (
    <div className="w-full min-w-0 select-none">
      {/* Aggregated context row — same rhythm as ToolTrace rows */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group -mx-1 flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left transition-colors duration-100 hover:bg-hover cursor-pointer"
      >
        <span className="flex size-4 flex-none items-center justify-center text-faint">
          {pending ? <Spinner size={12} className="text-dim" /> : <FolderSearch size={13} />}
        </span>

        {pending ? (
          <span className="flex-none text-[13px] font-medium text-dim shimmer-text">正在搜集上下文…</span>
        ) : (
          <span className="flex-none text-[13px] font-medium text-dim group-hover:text-fg transition-colors">
            已搜集上下文
          </span>
        )}

        {!pending && badges.length > 0 && (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ghost">
            {badges.join(" · ")}
          </span>
        )}

        <ChevronRight
          size={12}
          className={`flex-none text-ghost transition-transform duration-200 group-hover:text-faint ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>

      {/* Accordion detail list */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-250 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="mb-1 ml-[26px] mt-0.5 flex flex-col">
            {tools.map((t, i) => {
              const input = (t.input ?? {}) as Record<string, unknown>
              const target = String(
                input.path ?? input.file_path ?? input.pattern ?? input.command ?? input.url ?? input.query ?? "",
              )
              const hasOut = t.output !== undefined
              const isItemOpen = expandedIndex === i

              return (
                <div key={i} className="min-w-0">
                  <button
                    type="button"
                    disabled={!hasOut}
                    onClick={() => setExpandedIndex(isItemOpen ? null : i)}
                    className={`group/child -mx-1 flex h-6 w-full min-w-0 items-center gap-2 rounded px-1 text-left transition-colors ${
                      hasOut ? "cursor-pointer hover:bg-hover" : "cursor-default"
                    }`}
                  >
                    <span className="flex-none text-ghost">{getContextIcon(t.name)}</span>
                    {target ? (
                      <span className="truncate font-mono text-xs text-faint group-hover/child:text-dim">
                        {target}
                      </span>
                    ) : (
                      <span className="truncate font-mono text-xs text-faint">{t.name}</span>
                    )}
                    {t.isError && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="ml-auto flex-none text-bad">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    )}
                    {hasOut && !t.isError && (
                      <ChevronRight
                        size={11}
                        className={`ml-auto flex-none text-ghost transition-transform duration-150 ${
                          isItemOpen ? "rotate-90" : ""
                        }`}
                      />
                    )}
                  </button>

                  {/* Single item output expansion */}
                  {isItemOpen && hasOut && (
                    <pre className="mb-1 ml-1 max-h-48 select-text overflow-auto whitespace-pre-wrap break-all rounded-control border border-line bg-inset p-2.5 font-mono text-[11px] leading-relaxed text-dim shadow-hairline">
                      {t.output}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
