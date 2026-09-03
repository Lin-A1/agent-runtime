/**
 * Event-log folding (handoff §5.3 — the client folds the transcript from
 * StoredEventRow[]; never hand-write message arrays). Rules:
 *  - Session.Prompted → user turn; `data.images` renders on the LAST user
 *    message only (aging rule §5.5); the event's seq is the fork point.
 *  - Session.MessageAppended (assistant) → expand content into text /
 *    thinking / tool-call blocks; tool result messages backfill their call
 *    in call order; an `error` in the output marks the row red.
 *  - write/edit tool-calls fold into per-file change cards (write = whole
 *    add; edit = old/new hunk); read/glob/grep/bash paths fold into the
 *    per-turn file-activity tree.
 *  - TodoUpdated → todo dock (never the transcript body); GoalUpdated /
 *    MemoryStored / Interrupted / Compacted / steer → dimmed note rows.
 *  - Session.ModelCalled → trace rows (pre-review #38).
 */
import type { ChatImage, FileContent, ModelCallRow, SessionRow, StoredEventRow, TodoItem } from "./types"

// --- transcript blocks ---

export interface ToolBlock {
  kind: "tool"
  name: string
  input: unknown
  /** One-line argument preview for the collapsed chip. */
  summary: string
  output?: string
  isError?: boolean
  ts?: number
}

export type NoteVariant = "interrupt" | "compact" | "memory" | "goal" | "steer" | "info"

export type TurnBlock =
  | { kind: "text"; text: string; ts?: number }
  | { kind: "thinking"; text: string }
  | ToolBlock
  | { kind: "note"; text: string; variant: NoteVariant }
  | { kind: "modelcall"; call: ModelCallRow }

export interface FileChange {
  path: string
  tool: "write" | "edit"
  touches: number
  added: number
  removed: number
  diff: Array<{ kind: "add" | "del" | "same"; text: string }>
}

export type ActivityKind = "create" | "modify" | "view" | "delete"

export interface FileActivity {
  path: string
  kind: ActivityKind
  tool: string
}

export interface UserTurn {
  kind: "user"
  text: string
  seq: number
  ts?: number
  images?: ChatImage[]
  blocks: TurnBlock[]
  changes: FileChange[]
  activity: FileActivity[]
  modelCalls: ModelCallRow[]
}

export type TranscriptItem = UserTurn | { kind: "note"; text: string; variant: NoteVariant; ts?: number }

function lineDiff(oldText: string, newText: string): FileChange["diff"] {
  const a = oldText.length ? oldText.replace(/\n$/, "").split("\n") : []
  const b = newText.length ? newText.replace(/\n$/, "").split("\n") : []
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const out: FileChange["diff"] = []
  for (let i = 0; i < pre; i++) out.push({ kind: "same", text: a[i] ?? "" })
  for (let i = pre; i < a.length - suf; i++) out.push({ kind: "del", text: a[i] ?? "" })
  for (let i = pre; i < b.length - suf; i++) out.push({ kind: "add", text: b[i] ?? "" })
  for (let i = a.length - suf; i < a.length; i++) out.push({ kind: "same", text: a[i] ?? "" })
  return out
}

/** A one-line preview of a tool call's arguments for the collapsed chip. */
function toolSummary(name: string, input: Record<string, unknown>): string {
  const path = String(input.path ?? input.file_path ?? input.pattern ?? input.command ?? input.url ?? "")
  if (path) return path.length > 72 ? path.slice(0, 69) + "…" : path
  const keys = Object.keys(input)
  if (keys.length === 0) return name
  return `${name}(${keys.join(", ")})`
}

function activityFor(name: string, input: Record<string, unknown>): FileActivity | undefined {
  const path = String(input.path ?? input.file_path ?? input.pattern ?? "")
  const lc = name.toLowerCase()
  if (lc === "write" && path) return { path, kind: "create", tool: name }
  if (lc === "edit" && path) return { path, kind: "modify", tool: name }
  if (lc === "notebookedit" && path) return { path, kind: "modify", tool: name }
  if (/^(read|glob|grep|webfetch)$/.test(lc) && path) return { path, kind: "view", tool: name }
  if (lc === "bash") {
    const cmd = String(input.command ?? "")
    const m = cmd.match(/\b(?:rm|mv|del)\b\s+(?:-\S+\s+)*["']?([^\s"']+)["']?/)
    if (m?.[1]) return { path: m[1], kind: "delete", tool: name }
  }
  return undefined
}

function changeFor(name: string, input: Record<string, unknown>, prev: FileChange | undefined): FileChange | undefined {
  const path = String(input.path ?? input.file_path ?? "")
  if (!path) return undefined
  let diff: FileChange["diff"] | undefined
  if (/^write$/i.test(name) && typeof input.content === "string") diff = lineDiff("", input.content)
  else if (/^edit$/i.test(name)) diff = lineDiff(typeof input.old === "string" ? input.old : "", typeof input.new === "string" ? input.new : "")
  if (!diff) return undefined
  return {
    path,
    tool: name.toLowerCase() as "write" | "edit",
    touches: (prev?.touches ?? 0) + 1,
    added: diff.filter((d) => d.kind === "add").length,
    removed: diff.filter((d) => d.kind === "del").length,
    diff,
  }
}

/** Fold the durable event log into user turns with their assistant blocks. */
export function foldTranscript(events: StoredEventRow[]): TranscriptItem[] {
  const out: TranscriptItem[] = []
  let turn: UserTurn | null = null
  // Every prompt lands TWICE in a real log: PromptAdmitted at admission, then
  // Prompted at promotion — same prompt id. Without this dedup every user
  // turn renders twice on a wired session (fixtures hid it by using only one
  // of the two per turn).
  const seenPromptIds = new Set<string>()
  // tool-call blocks awaiting their result message (results arrive in order)
  const pendingTool: ToolBlock[] = []
  let textBuf = ""
  let textTs: number | undefined

  const flushText = (): void => {
    if (!textBuf) return
    const block: TurnBlock = { kind: "text", text: textBuf, ...(textTs ? { ts: textTs } : {}) }
    if (turn) turn.blocks.push(block)
    textBuf = ""
    textTs = undefined
  }
  const pushBlock = (b: TurnBlock): void => {
    flushText()
    if (turn) turn.blocks.push(b)
    else out.push({ kind: "note", text: b.kind === "note" ? b.text : "", variant: "info" })
  }
  const pushNote = (text: string, variant: NoteVariant): void => {
    flushText()
    if (turn) turn.blocks.push({ kind: "note", text, variant })
    else out.push({ kind: "note", text, variant })
  }

  for (const e of events) {
    const d = e.data ?? {}
    if (e.type === "Session.Prompted" || e.type === "Session.PromptAdmitted") {
      // Images are hydrated onto PromptAdmitted (content-addressed refs); the
      // older Prompted shape carries them directly — accept either.
      if (turn) flushText()
      const images = (d.images as ChatImage[] | undefined)?.filter((img) => img?.mime && img?.data)
      const delivery = String(d.delivery ?? "")
      const promptId = String(d.id ?? "")
      if (promptId && seenPromptIds.has(promptId)) continue
      if (promptId) seenPromptIds.add(promptId)
      turn = {
        kind: "user",
        text: String(d.prompt ?? d.text ?? ""),
        seq: e.seq,
        ...(e.ts ? { ts: e.ts } : {}),
        ...(images?.length ? { images } : {}),
        blocks: delivery === "steer" ? [{ kind: "note", text: "回合中追加", variant: "steer" }] : [],
        changes: [],
        activity: [],
        modelCalls: [],
      }
      out.push(turn)
      continue
    }
    if (e.type === "Session.MessageAppended") {
      const m = d.message as
        | { kind?: string; text?: string; content?: Array<Record<string, unknown>>; model?: string; output?: unknown }
        | undefined
      if (!m) continue
      if (m.kind === "assistant" && Array.isArray(m.content)) {
        for (const p of m.content) {
          const ptype = String(p.type ?? "")
          if (ptype === "text" && typeof p.text === "string" && p.text) {
            textBuf += p.text
            textTs = e.ts
          } else if ((ptype === "thinking" || ptype === "reasoning") && typeof p.text === "string" && p.text) {
            flushText()
            pushBlock({ kind: "thinking", text: p.text })
          } else if (ptype === "tool-call") {
            flushText()
            const name = String(p.name ?? "tool")
            const input = (p.input ?? {}) as Record<string, unknown>
            const block: ToolBlock = { kind: "tool", name, input, summary: toolSummary(name, input), ...(e.ts ? { ts: e.ts } : {}) }
            if (turn) {
              turn.blocks.push(block)
              const act = activityFor(name, input)
              if (act) turn.activity.push(act)
              const ch = changeFor(name, input, turn.changes.find((c) => c.path === (input.path ?? input.file_path)))
              if (ch) {
                const idx = turn.changes.findIndex((c) => c.path === ch.path)
                if (idx >= 0) turn.changes[idx] = ch
                else turn.changes.push(ch)
              }
            }
            pendingTool.push(block)
          }
        }
      } else if (m.kind === "tool") {
        const raw =
          m.output !== undefined
            ? typeof m.output === "string"
              ? m.output
              : JSON.stringify(m.output, null, 2)
            : Array.isArray(m.content)
              ? m.content.map((c) => String(c.text ?? "")).join("\n")
              : ""
        const resultText = raw.slice(0, 4000)
        const payloadError =
          /[{[]\s*"error"\s*:/i.test(resultText.slice(0, 200)) ||
          (typeof m.output === "object" && m.output !== null && "error" in (m.output as Record<string, unknown>))
        const block = pendingTool.shift()
        if (block) {
          block.output = resultText
          if (payloadError) block.isError = true
        } else {
          pushBlock({ kind: "tool", name: "tool", input: {}, summary: "tool result", output: resultText, isError: payloadError })
        }
      }
      continue
    }
    if (e.type === "Session.ModelCalled") {
      const call: ModelCallRow = {
        seq: e.seq,
        ...(e.ts ? { ts: e.ts } : {}),
        source: String(d.source ?? "turn") as ModelCallRow["source"],
        model: String(d.model ?? "?"),
        ...(typeof d.durationMs === "number" ? { durationMs: d.durationMs } : {}),
        ...(d.finish ? { finish: String(d.finish) } : {}),
        ...(typeof d.promptChars === "number" ? { promptChars: d.promptChars } : {}),
        ...(typeof d.outputChars === "number" ? { outputChars: d.outputChars } : {}),
        ...(d.error ? { error: String(d.error) } : {}),
        ...(typeof (d.usage as Record<string, unknown> | undefined)?.inputTokens === "number"
          ? {
              inputTokens: (d.usage as { inputTokens: number }).inputTokens,
              outputTokens: (d.usage as { outputTokens?: number }).outputTokens,
            }
          : {}),
      }
      if (turn) turn.modelCalls.push(call)
      continue
    }
    if (e.type === "Session.GoalUpdated") {
      pushNote(`目标：${String(d.objective ?? "")}（${String(d.status ?? "")}）`, "goal")
      continue
    }
    if (e.type === "Session.MemoryStored") {
      pushNote("已记住一条", "memory")
      continue
    }
    if (e.type === "Session.Interrupted") {
      pushNote("回合已中断", "interrupt")
      continue
    }
    if (e.type === "Session.Compacted") {
      pushNote("上下文已压缩", "compact")
      continue
    }
  }
  flushText()
  return out
}

/** Latest todo list folded from Session.TodoUpdated events (the dock reads
 *  this; todos never render inline). */
export function foldTodos(events: StoredEventRow[]): TodoItem[] {
  let todos: TodoItem[] = []
  for (const e of events) {
    if (e.type !== "Session.TodoUpdated") continue
    const next = (e.data?.todos as TodoItem[] | undefined) ?? []
    todos = next
  }
  return todos
}

// --- subagent seven-state derivation (pre-review §6.2 — one place only) ---

export type SubagentState = "running" | "waiting" | "blocked" | "success" | "failed" | "cancelled" | "lost"

export interface SubagentRow {
  session: import("./types").SessionRow
  state: SubagentState
  depth: number
}

/**
 * Derive the seven display states from wire-only signals:
 *  - settled            → success
 *  - interrupted + archived → cancelled; interrupted → failed
 *  - created (admitted, not yet driven) → waiting
 *  - active + live heartbeat  → running
 *  - active + no heartbeat    → lost (process-restart residue)
 *  - active while an approval is pending → blocked (oldest active child)
 */
export function deriveSubagents(
  rows: import("./types").SessionRow[],
  opts: { parentId: string; liveSessionIds?: Set<string>; blockedSessionIds?: Set<string> },
): SubagentRow[] {
  const children = rows.filter((r) => r.parentId === opts.parentId && !r.archived)
  const active = children.filter((r) => r.status === "active").sort((a, b) => a.updatedAt - b.updatedAt)
  const blocked = opts.blockedSessionIds
  const out: SubagentRow[] = children.map((session) => {
    let state: SubagentState
    if (session.status === "settled") state = "success"
    else if (session.status === "interrupted") state = session.archived ? "cancelled" : "failed"
    else if (session.status === "created") state = "waiting"
    else if (blocked?.has(session.sessionId)) state = "blocked"
    else if (opts.liveSessionIds && !opts.liveSessionIds.has(session.sessionId)) state = "lost"
    else state = "running"
    return { session, state, depth: 1 }
  })
  void active
  return out.sort((a, b) => b.session.updatedAt - a.session.updatedAt)
}

// --- helpers shared by pages ---

/** Compact relative time: 刚刚 / N 分钟前 / HH:mm / 昨天 / M月D日 */
export function relativeTime(ts: number): string {
  if (!(ts > 1000)) return "—"
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return "昨天"
  if (diff < 7 * 86_400_000) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** Make a raw/first-message title safe for list display. */
export function prettyTitle(title: string | undefined, fallback: string, max = 26): string {
  if (!title) return fallback
  const clean = title
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*`>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!clean) return fallback
  return clean.length > max ? clean.slice(0, max) + "…" : clean
}

/** Display name for a session row. The resident butler session is ALWAYS
 *  "newhorse" regardless of its derived or renamed title; every other row
 *  pretty-prints its title with a fallback. */
export function sessionDisplayName(row: Pick<SessionRow, "role" | "title">, fallback = "未命名会话", max = 26): string {
  if (row.role === "butler") return "newhorse"
  return prettyTitle(row.title, fallback, max)
}

/** data: URL for rendering a fixture/transport image (raw base64 on wire). */
export function imageUrl(img: ChatImage): string {
  return `data:${img.mime};base64,${img.data}`
}

/** File-viewer language hint for syntax highlighting (class-only; the shell
 *  renders plain mono text — highlighting arrives with wiring). */
export function langOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json", md: "md", css: "css", html: "html", py: "py", rs: "rust", go: "go", sh: "bash", sql: "sql" }
  return map[ext] ?? "text"
}

export function isImageFile(f: FileContent | { path: string }): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(f.path)
}
