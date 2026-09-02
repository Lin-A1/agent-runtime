/**
 * Transcript — renders foldTranscript() output. Never hand-written messages:
 * everything derives from StoredEventRow[].
 *  - user turns: right-aligned bubble, images (rendered; the aging rule only
 *    affects what the MODEL sees — historical images stay visible, §5.5.5),
 *    and the event seq as a fork point.
 *  - assistant blocks: markdown text, collapsible thinking, tool chips colored
 *    by category (§3.1 trajectory semantics), expandable output, error rows.
 *  - per-turn change summary card ("N 个文件已更改" → per-file diff), the
 *    ZCode changeSummary landing for file review (#7/#39).
 *  - steer / interrupt / compact / goal / memory notes render dimmed.
 */
import { useState } from "react"
import { AlertTriangle, ChevronRight, Cpu, FileDiff, GitFork, Sparkles, TerminalSquare, X } from "lucide-react"
import type { ModelCallRow, StoredEventRow } from "../api/types"
import { foldTranscript, imageUrl, relativeTime, type FileChange, type ToolBlock, type TurnBlock, type UserTurn } from "../api/fold"
import { Markdown } from "./Markdown"

export function Transcript({ events, sessionId, onFork }: { events: StoredEventRow[]; sessionId: string; onFork?: (seq: number) => void }): React.ReactElement {
  const items = foldTranscript(events)
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-4 md:px-6 md:py-6">
      {items.map((item, i) =>
        item.kind === "user" ? (
          <UserTurnView key={i} turn={item} onFork={onFork} />
        ) : (
          <NoteRow key={i} text={item.text} variant={item.variant} />
        ),
      )}
      <div className="mt-6 flex items-center justify-center gap-2 text-2xs text-ghost">
        <span className="font-mono">{sessionId.slice(0, 18)}</span>
      </div>
    </div>
  )
}

function UserTurnView({ turn, onFork }: { turn: UserTurn; onFork?: (seq: number) => void }): React.ReactElement {
  return (
    <div className="fade-up group/turn mb-6">
      {/* user message: a single quiet grey bubble, right-aligned, no avatar */}
      <div className="flex items-start justify-end gap-1.5">
        {onFork && (
          <button
            className="mt-2 opacity-0 transition-opacity group-hover/turn:opacity-100"
            title="从此处分叉"
            onClick={() => onFork(turn.seq)}
          >
            <GitFork size={13} className="text-ghost hover:text-dim" />
          </button>
        )}
        <div className="max-w-[92%] rounded-3xl rounded-br-lg bg-bg2 px-3.5 py-2.5 sm:max-w-[80%] sm:px-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{turn.text}</p>
          {turn.images && turn.images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {turn.images.map((img, j) => (
                <img key={j} src={imageUrl(img)} alt="附件" className="max-h-48 rounded-xl" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* assistant response: plain left-aligned column, no avatar */}
      <div className="mt-3 min-w-0">
        {turn.blocks.length === 0 && <ThinkingCaret />}
        {turn.blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
        {turn.changes.length > 0 && <ChangeCard changes={turn.changes} />}
        {turn.modelCalls.length > 0 && <ModelCallTrace calls={turn.modelCalls} />}
      </div>
    </div>
  )
}

function ThinkingCaret(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-1 text-2xs text-faint">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-faint" />
      newhorse 正在思考…
    </div>
  )
}

function BlockView({ block }: { block: TurnBlock }): React.ReactElement | null {
  if (block.kind === "text") return <Markdown text={block.text} />
  if (block.kind === "thinking") return <ThinkingBlock text={block.text} />
  if (block.kind === "tool") return <ToolRow block={block} />
  if (block.kind === "note") return <NoteRow text={block.text} variant={block.variant} />
  return null
}

function ThinkingBlock({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-2xs text-ghost hover:text-faint">
        <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined }} className="transition-transform" />
        <Sparkles size={11} />
        推理过程
      </button>
      {open && (
        <div className="ml-4 mt-1.5 border-l pl-3 text-2xs leading-relaxed text-faint" style={{ borderColor: "var(--line-strong)" }}>
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  )
}

/** Tool category color per handoff §3.1: file=blue, search=purple, execute=orange, agent=teal, other=faint. */
function toolCategory(name: string): { color: string; label: string } {
  const lc = name.toLowerCase()
  if (/^(read|write|edit|notebookedit|glob)$/.test(lc) || /^(read|write|edit)$/.test(lc)) return { color: "var(--traj-user)", label: "文件" }
  if (/^(bash|bashoutput|killshell|shell)/.test(lc)) return { color: "var(--traj-tool)", label: "执行" }
  if (/^(search|grep|glob|websearch|webfetch|list)/.test(lc)) return { color: "var(--traj-reasoning)", label: "检索" }
  if (/^(spawn_agent|send_message|declare_dag|followup_task|wait_agent)/.test(lc)) return { color: "var(--traj-assistant)", label: "编排" }
  if (/^(todo_write|goal_write|goal_read)/.test(lc)) return { color: "var(--traj-user)", label: "任务" }
  if (/^(memory_search|memory_write|skill)/.test(lc)) return { color: "var(--traj-reasoning)", label: "知识" }
  return { color: "var(--txt-faint)", label: "工具" }
}

function ToolRow({ block }: { block: ToolBlock }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const hasOutput = block.output !== undefined && block.output.length > 0
  const cat = toolCategory(block.name)
  return (
    <div className="my-0.5">
      <button
        onClick={() => (hasOutput || block.input) && setOpen((v) => !v)}
        className={`flex max-w-full items-center gap-2 rounded-lg border-l-2 px-2.5 py-1.5 text-left transition-colors ${hasOutput || block.input ? "hover:bg-hover" : "cursor-default"}`}
        style={{ borderLeftColor: cat.color, paddingLeft: 10 }}
      >
        <span className={`flex-none font-mono text-2xs ${block.isError ? "text-bad" : "text-dim"}`} style={!block.isError ? { color: cat.color } : undefined}>{block.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ghost">{block.summary}</span>
        <span className="flex-none rounded px-1 py-0.5 text-[10px]" style={{ color: cat.color, border: `1px solid ${cat.color}44` }}>{cat.label}</span>
        {block.isError ? (
          <span className="flex-none text-2xs text-bad">失败</span>
        ) : hasOutput ? (
          <ChevronRight size={12} className="flex-none text-ghost transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
        ) : (
          <span className="flex-none animate-pulse text-2xs text-ghost">运行中</span>
        )}
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-1">
          {!!block.input && Object.keys(block.input as Record<string, unknown>).length > 0 && (
            <details className="rounded-md bg-bg2 px-2.5 py-1.5">
              <summary className="cursor-pointer text-2xs text-faint">输入参数</summary>
              <pre className="mt-1 max-h-40 overflow-auto font-mono text-2xs leading-relaxed text-ghost">{JSON.stringify(block.input, null, 2)}</pre>
            </details>
          )}
          {hasOutput && (
            <pre
              className="max-h-72 overflow-auto rounded-lg bg-bg2 p-2.5 font-mono text-2xs leading-relaxed"
              style={{ color: block.isError ? "var(--bad)" : "var(--txt-faint)" }}
            >
              {typeof block.output === "string" ? block.output : JSON.stringify(block.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function ChangeCard({ changes }: { changes: FileChange[] }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const totalAdd = changes.reduce((s, c) => s + c.added, 0)
  const totalDel = changes.reduce((s, c) => s + c.removed, 0)
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line bg-bg2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover">
        <FileDiff size={13} className="flex-none text-faint" />
        <span className="text-xs text-dim">{changes.length} 个文件已更改</span>
        <span className="flex items-center gap-1.5 font-mono text-2xs">
          <span className="text-[var(--diff-add-fg)]">+{totalAdd}</span>
          <span className="text-[var(--diff-del-fg)]">−{totalDel}</span>
        </span>
        <ChevronRight size={13} className="ml-auto flex-none text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
      </button>
      {open && (
        <div className="border-t border-line">
          {changes.map((c) => (
            <FileDiffView key={c.path} change={c} />
          ))}
        </div>
      )}
    </div>
  )
}


/** ZCode modelTrajectory landing (#38): a quiet per-turn trace row —
 *  N 次调用 · 总 tokens · 总时长 — expandable to per-call metadata rows
 *  (source turn/compaction/extraction chips, duration, tokens, errors).
 *  Data = turn.modelCalls folded from Session.ModelCalled events. */
function ModelCallTrace({ calls }: { calls: ModelCallRow[] }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const totalIn = calls.reduce((s2, c) => s2 + (c.inputTokens ?? 0), 0)
  const totalOut = calls.reduce((s2, c) => s2 + (c.outputTokens ?? 0), 0)
  const totalMs = calls.reduce((s2, c) => s2 + (c.durationMs ?? 0), 0)
  const hasTokens = totalIn > 0 || totalOut > 0
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line bg-bg2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover">
        <Cpu size={13} className="flex-none text-faint" />
        <span className="text-xs text-dim">模型调用 {calls.length} 次</span>
        {hasTokens && (
          <span className="font-mono text-2xs text-ghost">↑{totalIn.toLocaleString()} ↓{totalOut.toLocaleString()} tokens</span>
        )}
        {totalMs > 0 && <span className="font-mono text-2xs text-ghost">「{(totalMs / 1000).toFixed(1)}s」</span>}
        <ChevronRight size={13} className="ml-auto flex-none text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          {calls.map((c, i) => (
            <div key={i} className="flex items-center gap-2 py-1 font-mono text-2xs">
              <span className="chip !py-0 !text-[10px]">{c.source === "turn" ? "主回合" : c.source === "compaction" ? "压缩" : c.source === "extraction" ? "抽取" : c.source}</span>
              <span className="flex-none text-dim">{c.model}</span>
              {c.durationMs !== undefined && <span className="text-ghost">{(c.durationMs / 1000).toFixed(1)}s</span>}
              {c.inputTokens !== undefined && <span className="ml-auto text-ghost">↑{c.inputTokens.toLocaleString()} ↓{(c.outputTokens ?? 0).toLocaleString()}</span>}
              {c.error && <span className="text-bad">{c.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
function FileDiffView({ change }: { change: FileChange }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-line last:border-b-0">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover">
        <TerminalSquare size={11} className="flex-none text-faint" />
        <span className="flex-1 truncate font-mono text-2xs text-dim">{change.path}</span>
        <span className="font-mono text-2xs text-[var(--diff-add-fg)]">+{change.added}</span>
        <span className="font-mono text-2xs text-[var(--diff-del-fg)]">−{change.removed}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-line bg-panel py-1 font-mono text-2xs leading-relaxed">
          {change.diff.map((l, i) => (
            <div key={i} className={`flex px-3 ${l.kind === "add" ? "cline add" : l.kind === "del" ? "cline del" : ""}`} style={l.kind === "same" ? { color: "var(--txt-ghost)" } : undefined}>
              <span className="whitespace-pre">{l.text || " "}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NoteRow({ text, variant }: { text: string; variant: string }): React.ReactElement {
  const icon = variant === "interrupt" ? <X size={11} /> : <Sparkles size={11} />
  return (
    <div className="my-2 flex items-center gap-2 text-2xs text-ghost">
      <span className="text-ghost">{icon}</span>
      <span className="italic">{text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
