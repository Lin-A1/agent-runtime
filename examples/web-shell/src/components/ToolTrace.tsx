import { useEffect, useState, type ReactElement } from "react"
import { Check, Copy } from "lucide-react"
import { fmtClock } from "../api/fold"
import { Spinner } from "./ui"

const ToolIcons: Record<string, ReactElement> = {
  bash: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17l6-5-6-5M12 19h8" />
    </svg>
  ),
  write: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  ),
  read: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  search: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
}

function resolveToolIcon(name: string): ReactElement {
  const lc = name.toLowerCase()
  if (lc.includes("bash") || lc.includes("command")) return ToolIcons.bash
  if (lc.includes("write") || lc.includes("edit") || lc.includes("patch")) return ToolIcons.write
  if (lc.includes("read") || lc.includes("file")) return ToolIcons.read
  if (lc.includes("search") || lc.includes("grep") || lc.includes("glob")) return ToolIcons.search
  return ToolIcons.bash
}

/** Friendly Chinese verb label per tool family (ZCode runtime semantics:
 *  编辑 / 终端 / 读取 / 搜索…). Unmapped tools keep their raw name. */
function toolDisplayName(name: string): string {
  const lc = name.toLowerCase()
  if (/bash|command|terminal/.test(lc)) return "终端"
  if (/edit|patch/.test(lc)) return "编辑"
  if (/write|create|notebook/.test(lc)) return "写入"
  if (/read|view|file/.test(lc)) return "读取"
  if (/grep|search|query/.test(lc)) return "搜索"
  if (/glob|list|find|ls/.test(lc)) return "浏览"
  if (/web|fetch|http/.test(lc)) return "网络"
  if (/todo|task/.test(lc)) return "任务"
  if (/memory|recall/.test(lc)) return "记忆"
  if (/skill/.test(lc)) return "技能"
  if (/spawn|agent|followup|send/.test(lc)) return "子代理"
  if (/goal/.test(lc)) return "目标"
  return name
}

const isShellTool = (name: string): boolean => /bash|command|terminal/i.test(name)
const isFileTool = (name: string): boolean => /edit|write|patch|notebook/i.test(name)

/** Split a tool path argument into (name, dir) for the ZCode-style edit row. */
function splitPath(path: string): { fileName: string; dir: string } {
  const fileName = path.split(/[\\/]/).pop() ?? path
  return { fileName, dir: path.slice(0, path.length - fileName.length) }
}

/**
 * ToolTrace — one execution step as a quiet 28px row (OpenCode BasicToolV2 /
 * ZCode step-row hybrid): icon · tool name · hairline parameter chip · status
 * mark. Output expands into a hairline terminal inset with sticky copy.
 * Failure is a red ✕ mark, never a text badge.
 */
export function ToolTrace({
  name,
  summary,
  output,
  isError,
  pending,
  diff,
}: {
  name: string
  summary: string
  output?: string
  isError?: boolean
  pending?: boolean
  /** Per-file diffstat for edit/write rows (from the folded change list). */
  diff?: { added: number; removed: number }
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [userToggled, setUserToggled] = useState(false)
  const [copied, setCopied] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const hasOutput = output !== undefined

  // Live per-tool stopwatch while the step is pending (ZCode/Claude-Code-style
  // "alive" feedback for long tools like bash).
  useEffect(() => {
    if (!pending) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [pending])

  // While a tool streams progress, the output panel auto-opens so the live
  // feed is visible — until the user explicitly toggles it.
  const expanded = userToggled ? open : !!pending && hasOutput

  const copyOutput = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!output) return
    void navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="w-full min-w-0 select-none">
      {/* Tool call row */}
      <button
        type="button"
        disabled={!hasOutput}
        aria-expanded={expanded}
        onClick={() => {
          setUserToggled(true)
          setOpen((current) => !expanded)
        }}
        title={isError ? (hasOutput ? "执行失败 — 点击查看输出" : "执行失败") : hasOutput ? "点击查看输出" : undefined}
        className={`group/row -mx-1 flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left transition-colors duration-100 hover:bg-hover ${
          hasOutput ? "cursor-pointer" : "cursor-default"
        }`}
      >
        {/* Left icon with hover morph into chevron */}
        <span className="relative flex size-4 flex-none items-center justify-center text-faint">
          {pending ? (
            <Spinner size={12} className="text-dim" />
          ) : (
            <>
              <span className={`transition-opacity duration-100 ${expanded ? "opacity-0" : hasOutput ? "group-hover/row:opacity-0" : ""}`}>
                {resolveToolIcon(name)}
              </span>
              {hasOutput && (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${
                    expanded ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
                  }`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </>
          )}
        </span>

        {/* Tool label — Chinese verb (ZCode runtime semantics) */}
        <span
          className={`flex-none text-[13px] font-medium ${
            isError ? "text-bad" : "text-dim group-hover/row:text-fg"
          } transition-colors`}
        >
          {toolDisplayName(name)}
        </span>

        {/* Argument display: file rows get name + dir + diffstat (ZCode edit
            row); everything else quiet mono text */}
        {summary &&
          (isFileTool(name) ? (() => {
            const { fileName, dir } = splitPath(summary)
            return (
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate" title={summary}>
                <span className="flex-none font-mono text-[13px] font-medium text-fg">{fileName}</span>
                {dir && <span className="min-w-0 truncate font-mono text-xs text-ghost">{dir}</span>}
                {diff && diff.added > 0 && (
                  <span className="flex-none font-mono text-xs text-ok">+{diff.added}</span>
                )}
                {diff && diff.removed > 0 && (
                  <span className="flex-none font-mono text-xs text-bad">-{diff.removed}</span>
                )}
              </span>
            )
          })() : (
            <span
              className="min-w-0 flex-1 max-w-[42rem] truncate font-mono text-xs text-faint transition-colors group-hover/row:text-dim"
              title={summary}
            >
              {summary}
            </span>
          ))}

        {/* Status marks: pending stopwatch, failure always visible, success on hover */}
        {pending && (
          <span className="flex-none font-mono text-2xs tabular-nums text-ghost">
            运行中 {fmtClock(elapsed * 1000)}
          </span>
        )}
        {isError && !pending && (
          <span className="flex-none text-bad" title="失败">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </span>
        )}
        {!isError && !pending && (
          <span className="flex-none text-ok opacity-0 transition-opacity duration-150 group-hover/row:opacity-70">
            <Check size={12} strokeWidth={2.5} />
          </span>
        )}
      </button>

      {/* Expanded terminal inset */}
      {hasOutput && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-250 ease-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
        >
          <div className="overflow-hidden">
            <div className="mb-1 ml-[26px] mt-0.5">
              <div className="relative max-h-80 overflow-auto rounded-lg border border-line bg-inset shadow-hairline">
                <button
                  type="button"
                  onClick={copyOutput}
                  className="sticky top-1.5 float-right m-2 ml-2 flex flex-none items-center gap-1 rounded-chip bg-field px-1.5 py-0.5 font-mono text-[10.5px] text-faint shadow-hairline transition-colors hover:bg-hover-2 hover:text-fg"
                  title="复制输出"
                >
                  {copied ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
                  <span>{copied ? "已复制" : "复制"}</span>
                </button>

                <div className="p-3.5">
                  {/* Shell echo line: `$ command` header (ZCode terminal panel) */}
                  {isShellTool(name) && summary && (
                    <div className="mb-2 select-text break-all border-b border-line/60 pb-2 font-mono text-xs leading-relaxed text-dim">
                      <span className="text-ghost">$ </span>
                      {summary}
                    </div>
                  )}
                  <pre className="select-text whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.7] text-dim">
                    {output}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
