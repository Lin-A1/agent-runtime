import type { ReactElement } from "react"
import type { FileActivity, FileChange, GoalFold, TranscriptItem, UserTurn } from "../api/fold"
import type { ContextView, PanelInfo, PolicyLevel, StoredEventRow, TodoItem } from "../api/types"
import type { LiveTurn } from "../state/store"

export type BuiltinWorkbenchTab = "agents" | "terminal" | "files" | "activity" | "preview" | "context"
export type WorkbenchTab = BuiltinWorkbenchTab | (string & {})

export type ProviderSource = "builtin" | "plugin" | "mcp"
export type CapabilityState = "ready" | "loading" | "error" | "unavailable"
export type ActorKind = "human" | "agent" | "system" | "waiting"
export type ActivityState = "idle" | "working" | "waiting" | "success" | "error" | "interrupted"

export interface WorkbenchResource {
  id: string
  label: string
  shortLabel: string
  description: string
  source: ProviderSource
  state: CapabilityState
  icon: "terminal" | "file" | "activity" | "preview" | "context" | "browser" | "git" | "review"
  reserved?: boolean
}

export interface WorkbenchProviderContext {
  sessionId: string
  wsName: string
  workspace?: string
  activity: SessionActivity
  openTab: (tab: WorkbenchTab) => void
  close: () => void
}

export interface WorkbenchActionResult {
  ok: boolean
  value?: unknown
  error?: string
}

export type WorkbenchProviderRenderer = (context: WorkbenchProviderContext) => ReactElement

export interface WorkbenchProvider {
  resource: WorkbenchResource
  actions?: readonly string[]
  render?: WorkbenchProviderRenderer
  execute?: (
    action: string,
    input: unknown,
    context: WorkbenchProviderContext,
  ) => Promise<WorkbenchActionResult>
}

export interface ActivityChange extends FileChange {
  state: "confirmed" | "attempted" | "failed"
  turnSeq?: number
}

export interface SessionActivity {
  actor: ActorKind
  state: ActivityState
  summary: string
  evidence: "session event" | "live stream" | "host/plugin"
  turns: UserTurn[]
  tools: Array<{ name: string; summary: string; state: "running" | "success" | "failed"; ts?: number }>
  changes: ActivityChange[]
  panels: PanelInfo[]
  goal: GoalFold | null
  todos: TodoItem[]
  context: ContextView | null
  policy: PolicyLevel | null
  model?: string
  events: StoredEventRow[]
  liveTurn?: LiveTurn
  transcriptItems: TranscriptItem[]
}

export type { FileActivity }
