/**
 * Wire types — field-for-field mirrors of the engine's HTTP responses
 * (handoff §5.1 / pre-review §2, verified against packages/server +
 * packages/runtime). The UI shell consumes these via the thin api stub
 * (`./client.ts`); wiring day = swap the stub body for real fetch calls,
 * components stay untouched.
 */

// --- sessions / events (§5.3) ---

export type SessionStatus = "created" | "active" | "settled" | "interrupted"

export interface SessionRow {
  sessionId: string
  workspace: string
  title?: string
  status: SessionStatus
  model?: string
  parentId?: string
  /** Persistent role key — UI copy always says "newhorse 会话", never this. */
  role?: "butler"
  projectId?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  tokensUsed?: number
}

/** One durable event row. `seq` is monotonic per aggregate; a USER event's
 *  seq is the fork point for 回退重发. `ts` is store write time (legacy rows
 *  may lack it — rendering must tolerate undefined). */
export interface StoredEventRow {
  aggregate?: string
  seq: number
  type: string
  data: Record<string, unknown>
  ts?: number
}

export interface ChatImage {
  mime: string
  /** raw base64, NO `data:` prefix (the transport contract, §5.5). */
  data: string
}

// --- settings (settings-api.ts RedactedSettings) ---

export type ProviderKind = "openai" | "anthropic" | "openai-responses" | string

export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model?: string
  contextWindowTokens?: number
  maxOutputTokens?: number
  hasApiKey: boolean
  apiKeyHint?: string
}

export interface ChannelConfig {
  id: string
  sessionId?: string
  webhookUrl?: string
  enabled?: boolean
  /** presence-only redaction of the HMAC secret. */
  hasSecret?: boolean
  /** write-only on PUT: absent/"" keeps the stored value, a value sets it. */
  secret?: string
}

export interface McpServerSettings {
  enabled?: boolean
  command?: string
  args?: string[]
  url?: string
  /** presence-only redaction of env/headers maps. */
  hasEnv?: boolean
  hasHeaders?: boolean
}

export type PolicyLevel = "strict" | "readonly" | "trusted"

export interface SettingsView {
  agentHome: string
  dataDir?: string
  model: string
  contextWindowTokens?: number
  maxOutputTokens?: number
  host: string
  port: number
  workspace: string
  allowBash: boolean
  allowPluginCode: boolean
  approvalPolicy: PolicyLevel
  activeProviderId?: string
  providers?: ProviderProfile[]
  channels?: ChannelConfig[]
  mcpServers?: Record<string, McpServerSettings>
  provider: {
    kind: ProviderKind
    baseUrl: string
    model?: string
    hasApiKey: boolean
    apiKeyHint?: string
  }
  hasToken: boolean
  memory: {
    on: boolean
    extraction: boolean
    vector: {
      enabled: boolean
      mode: "auto" | "brute" | "off"
      embedding: {
        kind: "minimax" | "openai-compatible" | string
        baseUrl: string
        model: string
        apiKey: string
        hasApiKey?: boolean
        apiKeyHint?: string
      }
    }
  }
}

// --- approvals (schema/execpolicy.ts + runtime/approvals.ts) ---

export interface ApprovalRequest {
  id: string
  kind: "command" | "path" | "mode" | "question"
  target: string
  decision?: string
  reason?: string
  /** question kind only: clickable choices. */
  options?: string[]
  createdAt?: number
  expiresAt?: number
}

// --- schedules (runtime/scheduler.ts) ---

export interface Schedule {
  id: string
  sessionId: string
  prompt: string
  enabled: boolean
  intervalMinutes?: number
  dailyAt?: string
  cron?: string
  createdAt: number
  lastRunAt?: number
  lastResult?: "ok" | "error"
  lastError?: string
}

// --- DAGs (core/agent/dag.ts + runtime/dag-api.ts) ---

export type DagNodeState = "pending" | "running" | "succeeded" | "failed" | "skipped" | "aborted"

export interface DagNodeStatus {
  node: string
  state: DagNodeState
  model?: string
  /** Declared edges from the durable DAG.Declared spec (lane grouping). */
  dependsOn?: string[]
}

export interface DagStatus {
  dagId: string
  nodes: DagNodeStatus[]
  done: boolean
  startedAt?: number
}

export interface DagSpec {
  nodes: Record<
    string,
    {
      id: string
      agent: { name: string; role?: string; model?: string }
      input?: string
      dependsOn?: string[]
      consumes?: string[]
      produces?: string
    }
  >
  entry?: string[]
}

// --- usage (server aggregateUsage) ---

export interface UsageDay {
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  cost: number
  steps: number
  byModel?: Record<string, { inputTokens: number; outputTokens: number }>
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  cost: number
  steps: number
}

export interface UsageSessionRow {
  sessionId: string
  model?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  cost: number
  steps: number
  lastActivity: number
}

export interface UsageSummary {
  days: UsageDay[]
  totals: UsageTotals
  sessions: number
  sessionRows?: UsageSessionRow[]
  note?: string
}

// --- memory (packages/memory) ---

export type MemoryType = "persona" | "episodic" | "instruction" | "fact"

export interface MemoryRecord {
  id: string
  content: string
  type: MemoryType
  priority: number
  sessionId: string
  agentId?: string
  userId?: string
  sourceIds?: string[]
  createdAt: number
}

// --- live directory (runtime/session-directory.ts) ---

export interface LiveEntry {
  sessionId: string
  endpoint: string
  pid: number
  heartbeatAt: number
}

export interface LiveView {
  self: string
  live: LiveEntry[]
}

// --- fs / file / capabilities ---

export interface FsEntry {
  name: string
  dir: boolean
}

export interface FileContent {
  path: string
  size: number
  encoding: "utf8" | "base64"
  content: string
  truncated?: boolean
}

export interface SkillInfo {
  name: string
  description?: string
  path: string
}

export interface AgentInfo {
  name: string
  description?: string
  model?: string
  allowedTools?: string[]
  role?: string
}

export interface CommandInfo {
  name: string
  description?: string
}

/** Flat — the server returns {catalog: ModelCatalog | null}; api.catalog()
 *  already unwraps the envelope, so this is the inner shape. */
export interface ModelCatalog {
  schemaVersion: number
  providers: Array<{
    id: string
    models: Array<{
      id: string
      kinds?: string[]
      modalities?: string[]
      contextWindowTokens?: number
      maxOutputTokens?: number
      reasoning?: boolean
    }>
  }>
}

// --- per-session surfaces ---

export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

export interface GoalView {
  objective: string
  status: "active" | "paused" | "blocked" | "complete" | string
  tokenBudget?: number
  tokensUsed?: number
}

export interface ContextView {
  chars: number
  estTokens: number
  windowTokens?: number
  ratio?: number
}

/** Model-call trace row (Session.ModelCalled fold — pre-review #38). */
export interface ModelCallRow {
  seq: number
  ts?: number
  source: "turn" | "compaction" | "extraction" | string
  model: string
  durationMs?: number
  finish?: string
  promptChars?: number
  outputChars?: number
  inputTokens?: number
  outputTokens?: number
  error?: string
}
