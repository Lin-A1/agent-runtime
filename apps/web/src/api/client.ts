/**
 * Engine API client — descriptor discipline borrowed from opencode's
 * `make()`: every call goes through ONE request core that normalizes errors
 * into a typed ClientError (status + parsed body), retries only TRANSPORT
 * failures (never a 4xx/5xx — the server answered), and shares a single SSE
 * frame parser between the prompt stream and the global event bus.
 *
 * Connection: same-origin by default (the engine serves this dist via
 * NEWHORSE_UI_DIR); a dev/remote origin + bearer token live in localStorage.
 */
import type {
  AgentInfo,
  ApprovalRequest,
  ChatImage,
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

// --- connection (localStorage-backed) ---

const BASE_KEY = "NEWHORSE_BASE_URL"
const TOKEN_KEY = "NEWHORSE_TOKEN"

export function baseUrl(): string {
  return localStorage.getItem(BASE_KEY) || window.location.origin
}

export function token(): string {
  return localStorage.getItem(TOKEN_KEY) || ""
}

export function setConnection(base: string, tok: string): void {
  if (base) localStorage.setItem(BASE_KEY, base.replace(/\/$/, ""))
  else localStorage.removeItem(BASE_KEY)
  if (tok) localStorage.setItem(TOKEN_KEY, tok)
  else localStorage.removeItem(TOKEN_KEY)
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" }
  const t = token()
  if (t) h.authorization = `Bearer ${t}`
  return h
}

// --- error taxonomy (opencode wrapClientError): one typed error with status
//     + parsed body; every UI surface can branch on .status instead of
//     string-matching messages ---

export class ClientError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`)
    this.name = "ClientError"
    this.status = status
    this.body = body
  }
}

async function parseError(res: Response): Promise<ClientError> {
  let body: unknown = null
  let msg = `HTTP ${res.status}`
  try {
    body = (await res.json()) as { error?: string }
    if ((body as { error?: string })?.error) msg = (body as { error?: string }).error as string
  } catch {
    // non-JSON error body — keep the status message
  }
  return new ClientError(res.status, body, msg)
}

// --- retry (opencode pattern): 3 attempts, 500ms doubling, 10s cap, and only
//     for a whitelist of transient transport messages. ClientError means the
//     server ANSWERED — never retried. AbortError never retried. ---

const TRANSIENT = /network|fetch|econnreset|econnrefused|enotfound|etimedout|timedout|socket hang up|load failed/i

export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (err instanceof ClientError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof DOMException && err.name === "AbortError") throw err
      if (attempt === attempts - 1 || !TRANSIENT.test(msg)) throw err
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 10_000)))
    }
  }
  throw lastErr
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return retry(async () => {
    const res = await fetch(baseUrl() + path, {
      method: init?.method ?? "GET",
      headers: headers(),
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    if (!res.ok) throw await parseError(res)
    return (await res.json()) as T
  })
}

function qs(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") usp.set(k, String(v))
  const s = usp.toString()
  return s ? `?${s}` : ""
}

// --- SSE (shared frame parser): CRLF-normalize, split blank-line blocks,
//     join data: lines, JSON.parse; 16MB guard against runaway frames ---

const MAX_FRAME_BYTES = 16 * 1024 * 1024

async function* sseFrames(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_FRAME_BYTES) throw new Error("SSE frame too large")
      buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
      let blockEnd: number
      while ((blockEnd = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, blockEnd)
        buffer = buffer.slice(blockEnd + 2)
        const data = block
          .split("\n")
          .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
          .join("\n")
        if (data !== "") yield data
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// --- prompt stream: LoopEvent frames + data: [DONE] ---

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown; isError?: boolean }
  | { type: "step"; step: number }
  | { type: "error"; code: string; message: string }
  | { type: "done"; step: number; needsContinuation: boolean; finish: string }
  | { type: "result"; [k: string]: unknown }

export interface StreamHandlers {
  onEvent: (e: StreamEvent) => void
  signal?: AbortSignal
}

/** POST /v1/session/:id/prompt and consume the SSE stream. Resolves with the
 *  final finish reason. The client-side abort doubles as interrupt (the
 *  engine treats a closed prompt connection as interrupt). */
export async function streamPrompt(id: string, text: string, handlers: StreamHandlers, images?: ChatImage[]): Promise<{ finish: string }> {
  const res = await fetch(`${baseUrl()}/v1/session/${id}/prompt`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text, ...(images?.length ? { images } : {}) }),
    signal: handlers.signal,
  })
  if (!res.ok) throw await parseError(res)
  let finish = "stop"
  for await (const data of sseFrames(res)) {
    if (data === "[DONE]") return { finish }
    try {
      const ev = JSON.parse(data) as StreamEvent
      if (ev.type === "done") finish = ev.finish
      handlers.onEvent(ev)
    } catch {
      // malformed frame — skip
    }
  }
  return { finish }
}

// --- the api surface (all shapes verified against packages/server) ---

export const api = {
  health: () => request<{ status: string }>("/v1/health"),
  createSession: (sessionId?: string, workspace?: string, asButler?: boolean) =>
    request<{ sessionId: string; messageCount: number }>("/v1/session", { method: "POST", body: { sessionId, workspace, asButler } }),
  sessions: (workspace?: string, status?: string) => request<SessionRow[]>(`/v1/sessions${qs({ workspace, status })}`),
  snapshot: (id: string) => request<{ id: string; headSeq: number }>(`/v1/session/${id}`),
  events: (id: string) => request<StoredEventRow[]>(`/v1/session/${id}/events`),
  streamPrompt,
  interrupt: (id: string) => request<{ interrupted: boolean }>(`/v1/session/${id}/interrupt`, { method: "POST" }),
  steer: (id: string, text: string) => request<{ admitted: boolean }>(`/v1/session/${id}/steer`, { method: "POST", body: { text } }),
  compact: (id: string) => request<{ boundarySeq: number; summary: string }>(`/v1/session/${id}/compact`, { method: "POST" }),

  policy: (id: string) => request<{ policy: "strict" | "readonly" | "trusted" }>(`/v1/session/${id}/policy`),
  setPolicy: (id: string, policy: "strict" | "readonly" | "trusted") =>
    request<{ policy: string }>(`/v1/session/${id}/policy`, { method: "POST", body: { policy } }),

  commands: () => request<{ commands: CommandInfo[] }>("/v1/commands"),
  runCommand: (id: string, text: string) => request<{ output: string }>(`/v1/session/${id}/command`, { method: "POST", body: { text } }),

  settings: () => request<SettingsView>("/v1/settings"),
  putSettings: (patch: unknown) => request<SettingsView>("/v1/settings", { method: "PUT", body: patch }),
  models: () => request<{ models: string[] }>("/v1/models").then((r) => r.models),
  catalog: () => request<{ catalog: ModelCatalog | null }>("/v1/models/catalog").then((r) => r.catalog),

  approvals: () => request<{ approvals: ApprovalRequest[] }>("/v1/approvals"),
  approve: (id: string, allow: boolean) => request<{ settled?: boolean }>(`/v1/approvals/${id}`, { method: "POST", body: { allow } }),

  usage: (days = 30) => request<UsageSummary>(`/v1/usage?days=${days}`),

  schedules: () => request<{ schedules: Schedule[] }>("/v1/schedules").then((r) => r.schedules),
  addSchedule: (input: unknown) => request<Schedule>("/v1/schedules", { method: "POST", body: input }),
  updateSchedule: (id: string, patch: unknown) => request<Schedule>(`/v1/schedules/${id}`, { method: "PATCH", body: patch }),
  removeSchedule: (id: string) => request<{ removed: boolean }>(`/v1/schedules/${id}`, { method: "DELETE" }),
  runSchedule: (id: string) => request<{ triggered: boolean }>(`/v1/schedules/${id}/run`, { method: "POST" }),

  goal: (id: string) => request<{ goal: GoalView | null; tokensUsed: number }>(`/v1/session/${id}/goal`),
  setGoal: (id: string, objective: string, tokenBudget?: number) =>
    request<{ objective: string }>(`/v1/session/${id}/goal`, { method: "POST", body: { objective, ...(tokenBudget !== undefined ? { tokenBudget } : {}) } }),
  todos: (id: string) => request<{ todos: TodoItem[] }>(`/v1/session/${id}/todos`),
  context: (id: string) => request<ContextView>(`/v1/session/${id}/context`),

  archiveSession: (id: string) => request<{ archived: boolean }>(`/v1/session/${id}/archive`, { method: "POST", body: { archived: true } }),
  unarchiveSession: (id: string) => request<{ archived: boolean }>(`/v1/session/${id}/archive`, { method: "POST", body: { archived: false } }),
  deleteSession: (id: string) => request<{ deleted: boolean }>(`/v1/session/${id}`, { method: "DELETE" }),
  forkSession: (id: string, atSeq?: number) =>
    request<{ sessionId: string; forkedFrom: string }>(`/v1/session/${id}/fork`, { method: "POST", body: atSeq !== undefined ? { atSeq } : {} }),
  setTitle: (id: string, title: string) => request<{ title: string }>(`/v1/session/${id}/title`, { method: "POST", body: { title } }),

  fs: (workspace?: string, path?: string) => request<{ path: string; entries: FsEntry[] }>(`/v1/fs${qs({ workspace, path })}`),
  file: (workspace: string | undefined, path: string) => request<FileContent>(`/v1/file${qs({ workspace, path })}`),

  skills: () => request<{ skills: SkillInfo[] }>("/v1/skills"),
  skillBody: (name: string) => request<{ name: string; description?: string; path?: string; body?: string }>(`/v1/skills${qs({ name })}`),
  importSkill: (name: string, body: string, description?: string) =>
    request<{ name: string; path: string }>("/v1/skills", { method: "POST", body: { name, body, ...(description ? { description } : {}) } }),
  agents: () => request<{ agents: AgentInfo[] }>("/v1/agents"),

  memory: (q = "") => request<{ memories: MemoryRecord[] }>(`/v1/memory${qs({ q })}`),
  writeMemory: (content: string, type?: MemoryType, priority?: number) =>
    request<MemoryRecord>("/v1/memory", { method: "POST", body: { content, ...(type ? { type } : {}), ...(priority !== undefined ? { priority } : {}) } }),
  deleteMemory: (id: string) => request<{ removed: boolean }>(`/v1/memory/${id}`, { method: "DELETE" }),

  dags: () => request<{ dags: DagStatus[] }>("/v1/dags").then((r) => r.dags),
  dag: (id: string) => request<DagStatus>(`/v1/dag/${id}`),
  createDag: (spec: DagSpec) => request<{ dagId: string }>("/v1/dag", { method: "POST", body: { spec } }),

  live: () => request<{ self: string; live: LiveView["live"] }>("/v1/live").then((r) => ({ self: r.self, live: r.live }) as LiveView),
  audit: (actorSessionId?: string) => request<unknown[]>(`/v1/audit${qs({ actorSessionId })}`),

  /** Channel test — server returns {channelId, sessionId, finish, reply}. */
  channelTest: (id: string, text: string) =>
    request<{ channelId: string; sessionId: string; finish: string; reply: string }>(`/v1/channel/${id}/inbound`, { method: "POST", body: { text } }),
}

// Shell conveniences kept from the fixture pass: the workspace-bound resident
// session id is DERIVED by the engine (stableSessionId(workspace)) — create
// without an id and read it back; never hardcode it client-side.
export async function ensureResidentSession(workspace?: string): Promise<string> {
  const rows = await api.sessions(workspace)
  const butler = rows.find((r) => r.role === "butler" && (!workspace || r.workspace === workspace))
  if (butler) return butler.sessionId
  const created = await api.createSession(undefined, workspace, true)
  return created.sessionId
}

export type Api = typeof api
