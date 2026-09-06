import { useId, useState, type ReactElement } from "react"
import { ChevronDown, FileDiff } from "lucide-react"
import type { FileChange } from "../api/fold"

/**
 * ChangeList — Git-style file changes display ported from BeautifulUI:
 * Shows modified files with green `+{added}` and red `-{removed}` pills,
 * expanding smoothly into unified patch diffs.
 */
function changeId(path: string, index: number): string {
  let hash = index
  for (const char of path) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `change-diff-${hash.toString(16)}`
}

export function ChangeList({ changes }: { changes: FileChange[] }): ReactElement | null {
  const listId = useId().replace(/:/g, "")
  const [openPath, setOpenPath] = useState<string | null>(null)
  if (!changes || changes.length === 0) return null

  return (
    <div className="my-2.5 flex flex-col gap-1.5">
      {changes.map((c, index) => {
        const isOpen = openPath === c.path
        const diffId = `${listId}-${changeId(c.path, index)}`
        return (
          <div key={c.path} className="min-w-0">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={diffId}
              onClick={() => setOpenPath(isOpen ? null : c.path)}
              className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-card-hover"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileDiff size={13} className="flex-none text-accent" />
                <span className="min-w-0 truncate font-mono text-xs text-fg">{c.path}</span>
              </div>

              <div className="flex flex-none items-center gap-2">
                {c.added > 0 && (
                  <span className="rounded-md bg-ok/10 px-1.5 py-0.5 font-mono text-2xs font-medium text-ok">
                    +{c.added}
                  </span>
                )}
                {c.removed > 0 && (
                  <span className="rounded-md bg-bad/10 px-1.5 py-0.5 font-mono text-2xs font-medium text-bad">
                    −{c.removed}
                  </span>
                )}
                <ChevronDown
                  size={12}
                  className="text-ghost transition-transform duration-200"
                  style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </div>
            </button>

            {/* Accordion Diff View */}
            <div
              id={diffId}
              aria-hidden={!isOpen}
              className="grid transition-[grid-template-rows,opacity] duration-250 ease-out"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", opacity: isOpen ? 1 : 0 }}
            >
              <div className="overflow-hidden">
                <div className="codeblock-body mt-1.5 max-h-80 overflow-auto rounded-md border border-line bg-bg2 py-1 text-2xs leading-relaxed">
                  {c.diff.map((d, i) => (
                    <div key={i} className={`cline ${d.kind}`}>
                      <span className="whitespace-pre-wrap break-all">{d.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
