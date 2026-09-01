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
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Copy,
  FileDiff,
  FilePen,
  FileText,
  GitFork,
  Hammer,
  Search,
  Sparkles,
  TerminalSquare,
  User,
  X,
} from "lucide-react"
import type { StoredEventRow } from "../api/types"
import { foldTranscript, imageUrl, relativeTime, type FileChange, type ToolBlock, type TurnBlock, type UserTurn } from "../api/fold"
import { Markdown } from "./Markdown"

type ToolCat = "file" | "exec" | "search" | "orch"
const TOOL_CAT: Record<string, ToolCat> = {
  read: "file", write: "file", edit: "file", notebookedit: "file", glob: "file", get_dir_structure: "file", view_file_in_detail: "file",
  bash: "exec", bashoutput: "exec", killshell: "exec",
  grep: "search", websearch: "search", webfetch: "search",
  task: "orch", spawn_agent: "orch", send_to_session: "orch", followup_task: "orch", wait_agent: "orch", declare_dag: "orch", skill: "orch", todowrite: "orch",
}
const CAT_COLOR: Record<ToolCat, string> = {
  file: "var(--traj-user)",
  exec: "var(--traj-tool)",
  search: "var(--traj-reasoning)",
  orch: "var(--traj-assistant)",
}
const CAT_ICON = (name: string, cat: ToolCat): React.ReactNode => {
  if (cat === "exec") return <Hammer size={12} />
  if (cat === "search") return <Search size={12} />
  if (cat === "orch") return <Sparkles size={12} />
  if (/write|edit/i.test(name)) return <FilePen size={12} />
  return <FileText size={12} />
}
function catOf(name: string): ToolCat {
  return TOOL_CAT[name.toLowerCase()] ?? "file"
}

export function Transcript({ events, sessionId }: { events: StoredEventRow[]; sessionId: string }): React.ReactElement {
  const items = foldTranscript(events)
  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-6">
      {items.map((item, i) =>
        item.kind === "user" ? (
          <UserTurnView key={i} turn={item} />
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

function UserTurnView({ turn }: { turn: UserTurn }): React.ReactElement {
  return (
    <div className="fade-up mb-5">
      {/* user message */}
      <div className="flex justify-end gap-3">
        <div className="max-w-[80%]">
          <div className="rounded-2xl rounded-tr-md border border-line bg-panel px-4 py-2.5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{turn.text}</p>
            {turn.images && turn.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {turn.images.map((img, j) => (
                  <img key={j} src={imageUrl(img)} alt="附件" className="max-h-48 rounded-lg border border-line" />
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 flex items-center justify-end gap-2 text-2xs text-ghost">
            {turn.ts ? relativeTime(turn.ts) : ""}
          </div>
        </div>
        <span className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full border border-line bg-bg2 text-faint">
          <User size={13} />
        </span>
      </div>

      {/* assistant response */}
      <div className="mt-3 flex gap-3">
        <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border border-line bg-bg2 text-trajassistant">
          <Bot size={13} />
        </span>
        <div className="min-w-0 flex-1">
          {turn.blocks.length === 0 && <ThinkingCaret />}
          {turn.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
          {turn.changes.length > 0 && <ChangeCard changes={turn.changes} />}
        </div>
      </div>
    </div>
  )
}

function ThinkingCaret(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-1 text-2xs text-faint">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-trajassistant" />
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
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-2xs text-faint hover:text-dim">
        <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined }} className="transition-transform" />
        <Sparkles size={11} style={{ color: "var(--traj-reasoning)" }} />
        推理过程
      </button>
      {open && (
        <div className="ml-4 mt-1.5 border-l-2 pl-3 text-2xs leading-relaxed text-faint" style={{ borderColor: "var(--traj-reasoning)" }}>
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  )
}

function ToolRow({ block }: { block: ToolBlock }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const cat = catOf(block.name)
  const color = CAT_COLOR[cat]
  const hasOutput = block.output !== undefined && block.output.length > 0
  return (
    <div className="my-1.5 flex gap-2">
      <span className="mt-1.5 w-[2px] flex-none self-stretch rounded-full" style={{ background: block.isError ? "var(--bad)" : color }} />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => hasOutput && setOpen((v) => !v)}
          className={`flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${hasOutput ? "hover:border-linestrong" : "cursor-default"}`}
          style={{ borderColor: "var(--line)", background: "var(--bg2)" }}
        >
          <span style={{ color: block.isError ? "var(--bad)" : color }}>{block.isError ? <AlertTriangle size={12} /> : CAT_ICON(block.name, cat)}</span>
          <span className="font-mono text-2xs font-medium" style={{ color: block.isError ? "var(--bad)" : "var(--txt)" }}>
            {block.name}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-faint">{block.summary}</span>
          {block.isError ? (
            <span className="flex-none text-2xs text-bad">失败</span>
          ) : hasOutput ? (
            <ChevronRight size={12} className="flex-none text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
          ) : (
            <span className="flex-none animate-pulse text-2xs text-faint">运行中</span>
          )}
        </button>
        {open && hasOutput && (
          <pre
            className="mt-1 max-h-72 overflow-auto rounded-lg border border-line p-2.5 font-mono text-2xs leading-relaxed"
            style={{ background: "var(--bg2)", color: block.isError ? "var(--diff-del-fg)" : "var(--txt-dim)" }}
          >
            {block.output}
          </pre>
        )}
      </div>
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
        <FileDiff size={13} className="flex-none text-trajtool" />
        <span className="text-xs font-medium text-fg">{changes.length} 个文件已更改</span>
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
  const icon =
    variant === "interrupt" ? <X size={11} /> :
    variant === "steer" ? <TerminalSquare size={11} /> :
    variant === "goal" ? <Check size={11} /> :
    variant === "memory" ? <Sparkles size={11} /> :
    <GitFork size={11} />
  return (
    <div className="my-2 flex items-center gap-2 text-2xs text-faint">
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-line bg-bg2">{icon}</span>
      <span className="italic">{text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

void Copy
