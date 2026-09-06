import { foldGoal, foldPanels, foldTodos, type FileChange, type ToolBlock, type TranscriptItem, type UserTurn } from "../api/fold"
import type { ContextView, PanelInfo, PolicyLevel, StoredEventRow } from "../api/types"
import type { LiveTurn } from "../state/store"
import type { ActivityChange, SessionActivity } from "./types"

function changeState(turn: UserTurn, change: FileChange): ActivityChange["state"] {
  const related = turn.blocks.filter((block): block is ToolBlock => block.kind === "tool").filter((block) => {
    const input = block.input as Record<string, unknown> | null
    return String(input?.path ?? input?.file_path ?? "") === change.path
  })
  if (related.some((tool) => tool.isError)) return "failed"
  if (related.some((tool) => tool.output !== undefined)) return "confirmed"
  return "attempted"
}

function toolRows(turns: UserTurn[], liveTurn?: LiveTurn): SessionActivity["tools"] {
  const durable = turns.flatMap((turn) => turn.blocks.filter((block): block is ToolBlock => block.kind === "tool").map((block) => ({ name: block.name, summary: block.summary, state: block.isError ? "failed" as const : "success" as const, ts: block.ts })))
  const live = (liveTurn?.blocks ?? []).filter((block): block is Extract<LiveTurn["blocks"][number], { kind: "tool" }> => block.kind === "tool").map((block) => ({ name: block.name, summary: typeof block.input === "object" && block.input ? String((block.input as Record<string, unknown>).path ?? (block.input as Record<string, unknown>).command ?? block.name) : block.name, state: block.output === undefined || block.streaming ? "running" as const : block.isError ? "failed" as const : "success" as const }))
  return [...durable, ...live].slice(-12).reverse()
}

function latestSummary(liveTurn: LiveTurn | undefined, tools: SessionActivity["tools"], goal: ReturnType<typeof foldGoal>): { actor: SessionActivity["actor"]; state: SessionActivity["state"]; summary: string; evidence: SessionActivity["evidence"] } {
  if (liveTurn?.busy) {
    const last = tools[0]
    return { actor: "agent", state: "working", summary: last ? `正在执行 ${last.name}` : "正在生成回应", evidence: "live stream" }
  }
  if (liveTurn?.error) return { actor: "agent", state: "error", summary: "最近回合未完成", evidence: "live stream" }
  if (goal?.status === "complete" || goal?.status === "completed") return { actor: "system", state: "success", summary: "目标已完成", evidence: "session event" }
  if (tools[0]) return { actor: "agent", state: tools[0].state === "failed" ? "error" : "success", summary: `最近执行 ${tools[0].name}`, evidence: "session event" }
  return { actor: "waiting", state: "idle", summary: "等待下一步", evidence: "session event" }
}

export function deriveSessionActivity({ events, items, liveTurn, context, policy }: { events: StoredEventRow[]; items: TranscriptItem[]; liveTurn?: LiveTurn; context?: ContextView | null; policy?: PolicyLevel | null }): SessionActivity {
  const turns = items.filter((item): item is UserTurn => item.kind === "user")
  const goal = events.length ? foldGoal(events) : null
  const todos = events.length ? foldTodos(events) : []
  const panels = [...foldPanels(events), ...(liveTurn?.panels ?? [])].reduce<PanelInfo[]>((all, panel) => all.some((item) => item.panelId === panel.panelId) ? all : [...all, panel], [])
  const changes: ActivityChange[] = turns.flatMap((turn) => turn.changes.map((change) => ({ ...change, state: changeState(turn, change), turnSeq: turn.seq })))
  const tools = toolRows(turns, liveTurn)
  const summary = latestSummary(liveTurn, tools, goal)
  return { ...summary, turns, tools, changes, panels, goal, todos, context: context ?? null, policy: policy ?? null, events, liveTurn, transcriptItems: items }
}
