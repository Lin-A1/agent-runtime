/**
 * Data boundary for the UI-shell stage. Every method is a SYNCHRONOUS read of
 * an in-repo fixture — the build decision for this pass is "数据全部写死": no
 * fetch, no latency, no scenario switching. Method names, arguments and return
 * shapes already match the future HTTP calls (handoff §5.1); wiring day swaps
 * these bodies for real fetch/SSE and flips useApi to async — components do
 * not change.
 */
import type {
  AgentInfo,
  ApprovalRequest,
  CommandInfo,
  ContextView,
  DagSpec,
  DagStatus,
  FileContent,
  FsEntry,
  GoalView,
  LiveView,
  MemoryRecord,
  MemoryType,
  ModelCatalog,
  Schedule,
  SessionRow,
  SettingsView,
  SkillInfo,
  StoredEventRow,
  TodoItem,
  UsageSummary,
} from "./types"
import { foldTodos } from "./fold"
import { buildDemoEvents, buildChildEvents } from "../fixtures/events"
import { buildSessions, BUTLER_NH, WS_NH } from "../fixtures/sessions"
import { buildSettings, buildModels, buildCatalog } from "../fixtures/settings"
import {
  buildApprovals,
  buildSchedules,
  buildDags,
  buildUsage,
  buildMemories,
  buildLive,
  buildFsRoot,
  buildFsPackages,
  buildFile,
  buildSkills,
  buildAgents,
  buildCommands,
  buildTodos,
  buildGoal,
  buildContext,
} from "../fixtures/collections"

const sessions = buildSessions()
const demoEvents = buildDemoEvents()
const settings = buildSettings()

export const api = {
  // --- sessions ---
  health: () => ({ status: "ok" }),
  createSession: (_sessionId?: string, _workspace?: string, _asButler?: boolean) => ({ sessionId: BUTLER_NH, messageCount: 0 }),
  sessions: (_workspace?: string, _status?: string): SessionRow[] => sessions,
  snapshot: (id: string) => ({ id, headSeq: 42 }),
  events: (id: string): StoredEventRow[] =>
    id === BUTLER_NH ? demoEvents : id.startsWith("sess-nh-child") ? buildChildEvents("子代理任务") : demoEvents.slice(0, 2),
  interrupt: (_id: string) => ({ interrupted: true }),
  steer: (_id: string, _text: string) => ({ admitted: true }),

  // --- policy ---
  policy: (_id: string) => ({ policy: "strict" as const }),
  setPolicy: (_id: string, policy: "strict" | "readonly" | "trusted") => ({ policy }),

  // --- commands ---
  commands: (): { commands: CommandInfo[] } => ({ commands: buildCommands() }),
  runCommand: (_id: string, _text: string) => ({ output: "ok" }),

  // --- settings / models ---
  settings: (): SettingsView => settings,
  putSettings: (_patch: unknown): SettingsView => settings,
  models: () => buildModels(),
  catalog: (): ModelCatalog => buildCatalog(),

  // --- approvals ---
  approvals: (): { approvals: ApprovalRequest[] } => ({ approvals: buildApprovals() }),
  approve: (_id: string, _allow: boolean) => ({ settled: true }),

  // --- usage ---
  usage: (_days = 30): UsageSummary => buildUsage(),

  // --- schedules ---
  schedules: (): Schedule[] => buildSchedules(),
  addSchedule: (_input: unknown) => ({ id: "sch-new", createdAt: Date.now() }),
  updateSchedule: (_id: string, _patch: unknown) => ({ ok: true }),
  removeSchedule: (_id: string) => ({ removed: true }),
  runSchedule: (_id: string) => ({ triggered: true }),

  // --- goal / todos / context ---
  goal: (_id: string): { goal: GoalView | null; tokensUsed: number } => ({ goal: buildGoal(), tokensUsed: 182_400 }),
  setGoal: (_id: string, objective: string, _tokenBudget?: number) => ({ objective }),
  todos: (id: string): { todos: TodoItem[] } => ({
    todos: id === BUTLER_NH ? buildTodos() : foldTodos(buildChildEvents("x")),
  }),
  context: (_id: string): ContextView => buildContext(),

  // --- session management ---
  archiveSession: (_id: string) => ({ archived: true }),
  unarchiveSession: (_id: string) => ({ archived: false }),
  deleteSession: (_id: string) => ({ deleted: true }),
  forkSession: (id: string, _atSeq?: number) => ({ sessionId: "sess-fork-new", forkedFrom: id }),
  setTitle: (_id: string, title: string) => ({ title }),
  fs: (_workspace?: string, path?: string): { path: string; entries: FsEntry[] } => ({
    path: path ?? ".",
    entries: path && path.includes("packages") ? buildFsPackages() : buildFsRoot(),
  }),
  file: (_workspace: string | undefined, path: string): FileContent => buildFile(path),

  // --- capabilities ---
  skills: (): { skills: SkillInfo[] } => ({ skills: buildSkills() }),
  skillBody: (name: string) => ({ name, body: "# skill\n\n正文加载后显示。" }),
  agents: (): { agents: AgentInfo[] } => ({ agents: buildAgents() }),

  // --- memory ---
  memory: (_q = ""): { memories: MemoryRecord[] } => ({ memories: buildMemories() }),
  writeMemory: (_content: string, _type?: MemoryType, _priority?: number) => ({ ok: true }),
  deleteMemory: (_id: string) => ({ removed: true }),

  // --- dags ---
  dags: (): DagStatus[] => buildDags(),
  dag: (id: string): DagStatus | undefined => buildDags().find((d) => d.dagId === id) ?? buildDags()[0],
  createDag: (_spec: DagSpec) => ({ dagId: "dag-new" }),

  // --- live / audit ---
  live: (): LiveView => buildLive(),
  audit: (_actorSessionId?: string) => ({
    rows: [
      { seq: 1, ts: Date.now() - 60_000, actorKind: "user", action: "prompt", targetSessionId: BUTLER_NH, allowed: true },
      { seq: 2, ts: Date.now() - 30_000, actorKind: "butler", action: "spawn", targetSessionId: "sess-nh-child-run", allowed: true },
    ],
  }),

  // --- channels (inbound test) ---
  channelTest: (_id: string, _text: string) => ({ sessionId: BUTLER_NH, finish: "stop", text: "已收到测试消息" }),
}

export type Api = typeof api
export { WS_NH, BUTLER_NH }
