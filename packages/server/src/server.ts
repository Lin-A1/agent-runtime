import { createApp, redactSettings, aggregateUsage, loadModelCatalog, createDagRunner, handleChannelInbound, channelSessionId, type App, type AppEvent, type AppConfig, type PromptResult, type SessionRow, type RegistryQuery, type AuditEventRow, type SessionDirectory, type DirectoryEntry, type SettingsController, type AgentHomeConfig, type ApprovalHub, type Scheduler, type ScheduleInput, type Schedule, type DagRunner, type DagStatus, type ChannelConfig } from "@newhorse/runtime"
import { currentGoal, tokensUsed as foldTokensUsed, currentTodos, validateGoal, projectCompacted, clearStaleToolResults, compactLimit, validate as validateDag } from "@newhorse/core"
import { discoverSkills, discoverPlugin } from "@newhorse/plugin"
import { SessionRegistry, SqliteEventStore, type DAGSpec } from "@newhorse/core"
import { Database } from "bun:sqlite"
import type { MemoryStore, MemoryRecord } from "@newhorse/memory"
import { listModels } from "@newhorse/llm"
import type { AdapterConfig, Fetcher } from "@newhorse/llm"
import { networkInterfaces } from "node:os"

/** First non-loopback IPv4 address — the LAN URL host for the phone.
 *  Preference: real private LAN ranges (192.168/10/172.16-31) first, then any
 *  non-loopback. APIPA (169.254 — unconnected adapters) and the benchmarking
 *  range (198.18/19 — common virtual adapter net) are skipped as they are not
 *  host routes a phone can reach. */
function firstLanIpv4(): string | undefined {
  const candidates: string[] = []
  const prefer: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== "IPv4" || ni.internal) continue
      const a = ni.address
      if (a.startsWith("169.254.") || a.startsWith("198.18.") || a.startsWith("198.19.")) continue
      if (a.startsWith("192.168.") || a.startsWith("10.") || (a.startsWith("172.") && Number(a.split(".")[1]) >= 16 && Number(a.split(".")[1]) <= 31)) {
        prefer.push(a)
      } else {
        candidates.push(a)
      }
    }
  }
  return prefer[0] ?? candidates[0]
}
import type { StoredEvent, ApprovalRequest } from "@newhorse/schema"
import { join, resolve, sep } from "node:path"
import { readdir, realpath, mkdir, writeFile, rename, rm } from "node:fs/promises"
import { Buffer } from "node:buffer"

/**
 * Runtime server (Phase 1): transport-only HTTP + SSE boundary over `createApp`.
 *
 * Per AGENTS.md, the server holds NO domain logic — it parses HTTP, maps
 * endpoints to `App` members, and streams `LoopEvent`s. All session/agent/llm
 * concerns live in the runtime.
 *
 * Sessions are held in a process-local map (sessionId → App); `POST /session`
 * creates or attaches. Multiple sessions run in parallel; each `App` is one
 * durable session attached to a workspace.
 *
 * Cross-process routing (M4, optional): when a `directory` is configured,
 * sessions created here are REGISTERED with this server's URL, so a sibling
 * server process can interrupt/steer/observe them by proxying over HTTP —
 * and vice versa (a miss in the local map resolves through the directory).
 * The directory is one shared SQLite file (see createSqliteSessionDirectory).
 */

/** Server configuration (transport concerns only). */
export interface ServerConfig {
  /** Host to bind. Default 127.0.0.1 (loopback-only). */
  readonly host?: string
  /** Port to bind. Default 3927. */
  readonly port?: number
  /**
   * Socket idle timeout in seconds (Bun default 10 kills SSE streams that go
   * quiet during long tool executions). Default 120; a 15s SSE keepalive
   * comment also runs on every prompt stream, so only pathological gaps
   * depend on this.
   */
  readonly idleTimeout?: number
  /**
   * Optional bearer token. When set, every request must carry
   * `Authorization: Bearer <token>` (constant-time compare). When absent,
   * only loopback binds are accepted.
   */
  readonly token?: string
  /** Per-session configuration factory — how to build an App for a workspace. */
  readonly sessionConfig?: (
    create: SessionCreateRequest,
  ) => Promise<AppConfig> | AppConfig
  /** Transport-injected approval gate (M4 execpolicy). Absent → fail-closed. */
  readonly onApprove?: (req: ApprovalRequest) => Promise<boolean>
  /** Pluggable session resolver (host lazy re-attach). */
  readonly sessionResolver?: SessionResolver
  /**
   * Cross-process live-session directory. When set, owned sessions are
   * registered so sibling processes can reach them, and sessions owned by
   * siblings are proxied on a local-map miss. Heartbeats keep ownership
   * alive; stop() unregisters everything this process created.
   */
  readonly directory?: SessionDirectory
  /** URL other processes use to reach THIS server (default: derived baseUrl). */
  readonly advertiseUrl?: string
  /** Directory with the built client UI (index.html + assets). When set, all
   *  non-/v1 GET paths serve it with SPA fallback — one origin for API + UI:
   *  standalone web, LAN mobile, and the desktop webview are the same artifact. */
  readonly uiDir?: string
  /** Settings surface for the client's settings page (read effective / write patch). */
  readonly settings?: SettingsController
  /** Interactive approval hub: the engine's gate parks requests here and the
   *  client settles them via /v1/approvals. When present it is the DEFAULT
   *  gate for created sessions (an explicit onApprove still wins). */
  readonly approvals?: ApprovalHub
  /** Scheduled prompts (定时任务). CRUD via /v1/schedules; the caller owns the
   *  tick loop (the standalone entrypoint starts one; a host may use its own). */
  readonly schedules?: Scheduler
  /** Injectable fetch for the provider models listing (tests). */
  readonly modelsFetch?: Fetcher
  /** Shared memory store — client memory browser reads/deletes via /v1/memory. */
  readonly memory?: MemoryStore
  /** Scheduled + on-demand DAG orchestration (编排). */
  readonly dagRunner?: DagRunner
  /** Plugin directory — skills/agents discovery for the capability browser. */
  readonly pluginsDir?: string
  /** Agent home directory — where the optional model-catalog.json lives
   *  (GET /v1/models/catalog serves it; absent → catalog endpoint returns null). */
  readonly agentHome?: string
  /** Inbound channels (webhook-first; docs/agent-runtime-integrations.md §6).
   *  Absent → /v1/channel/* routes return 404. */
  readonly channels?: readonly ChannelConfig[]
  /** Transport-level extra tools (e.g. mounted MCP servers) merged ADDITIVELY
   *  into every session's AppConfig.tools — first same-name occurrence wins,
   *  builtins/plugins keep their precedence (runtime toolset rules). */
  readonly tools?: import("@newhorse/core").Tool[]
  /** MCP resource surface (from the same createMcpTools mount): server name →
   *  resources + readResource. Powers GET /v1/mcp/resources and
   *  GET /v1/mcp/resource — absent → both routes return 404. */
  readonly mcpResources?: {
    readonly byServer: Record<string, { resources: ReadonlyArray<{ uri: string; name?: string; description?: string; mimeType?: string }>; error?: string }>
    readonly readResource: (server: string, uri: string) => Promise<{ text: string; mimeType?: string }>
  }
}

/** One session's create config (POST /v1/session body), transport DTO. */
export interface SessionCreateRequest {
  readonly workspace?: string
  readonly sessionId?: string
  readonly model?: string
  /** Optional project id (grouping key) — persisted on Session.Created so the
   *  registry can fold + query sessions per project. */
  readonly projectId?: string
  /** Create the session as the fixed BUTLER role (coordinator toolset + body). */
  readonly asButler?: boolean
  /** The create-model's context window in tokens (scales auto-compaction). */
  readonly contextWindowTokens?: number
  /** Output budget per reply in tokens (avoids the anthropic 4096 floor). */
  readonly maxOutputTokens?: number
  readonly provider?: AdapterConfig
  readonly enableBash?: boolean
  readonly pluginsDir?: string
  readonly dataDir?: string
  readonly tools?: ReadonlyArray<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
}

/**
 * Pluggable session resolver — consulted when a session id is NOT in the
 * server's local map (a host may lazily re-attach sessions from disk, proxy
 * to another node, etc.). Default: absent → local map only.
 */
export type SessionResolver = (sessionId: string) => Promise<App | undefined> | App | undefined

export interface ServerHandle {
  /** Base URL to reach this server (e.g. http://127.0.0.1:3927). */
  readonly baseUrl: string
  /** Read a session (test/debug helper). */
  readonly appFor: (sessionId: string) => App | undefined
  /** Fire-and-forget a user prompt into a session (get-or-create) — the
   *  scheduled-prompts delivery path; the prompt lands in the durable inbox. */
  readonly admitPrompt: (sessionId: string, prompt: string) => Promise<void>
  readonly stop: () => Promise<void>
}

/** Image attachment caps: per-image base64 (≈3MB raw, inside Anthropic's
 *  ~3.75MB base64/image guidance), per-prompt count, and the whole-body read
 *  bound. Worst case one request ≈ 5×4M base64 ≈ 20MB < the 32MB API ceiling. */
const MAX_IMAGE_BASE64 = 4_000_000
const MAX_IMAGES_PER_PROMPT = 5
const MAX_PROMPT_BODY = 40_000_000

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function bearer(req: Request): string | undefined {
  const auth = req.headers.get("authorization")
  if (!auth || !auth.startsWith("Bearer ")) return undefined
  return auth.slice(7)
}

/** Bound actual bytes before decoding or parsing, even for chunked requests. */
export async function readJsonOr400<T>(req: Request, limit = MAX_PROMPT_BODY): Promise<T | { error: string } | Response> {
  const reader = req.body?.getReader()
  const oversized = (): Response => {
    // Do not wait for an uncooperative sender to acknowledge cancellation.
    void reader?.cancel().catch(() => {})
    return json(413, { error: "request body too large" })
  }
  try {
    if (Number(req.headers.get("content-length")) > limit) return oversized()
    if (!reader) return {} as T
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) return oversized()
      chunks.push(chunk.value)
    }
    if (!size) return {} as T
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return { error: "malformed JSON body" }
  } finally {
    reader?.releaseLock()
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** Inline materials resolved from text @-references. Each authorinjected block
 *  is marked so the model sees it is injected context, not its own words. */
async function expandReferences(
  text: string,
  sources: {
    agents: Array<{ name: string; body?: string; description?: string }>
    skills: Array<{ name: string; body?: string; description?: string }>
    mcpResources: { readResource: (server: string, uri: string) => Promise<{ text: string; mimeType?: string }> } | null
  },
  resolved: Array<{ kind: "agent" | "skill" | "mcp"; label: string; content: string }>,
): Promise<string> {
  let out = text
  // Pre-resolve MCP refs (they need an await — String.replace's callback is
  // sync and would otherwise inline "[object Promise]").
  const mcpContents = new Map<string, string>()
  if (sources.mcpResources) {
    const mcpRefs = new Set<string>()
    for (const m of out.matchAll(/@mcp:([^\s]+)/g)) mcpRefs.add(m[1]!)
    for (const ref of mcpRefs) {
      const sep = ref.indexOf("/")
      const server = sep === -1 ? ref : ref.slice(0, sep)
      const uri = sep === -1 ? "" : ref.slice(sep + 1)
      if (!server || !uri) continue
      try {
        const r = await sources.mcpResources.readResource(server, uri)
        if (r.text) mcpContents.set(`@mcp:${ref}`, r.text)
      } catch {
        // Unresolvable — leave the literal token.
      }
    }
  }
  // Scan left-to-right; a ref resolved to content declares it and inlines it.
  out = out.replace(/@(agent|skill|mcp):([^\s]+)/g, (raw, kind: string, ref: string) => {
    const k = kind as "agent" | "skill" | "mcp"
    if (k === "agent") {
      const agent = sources.agents.find((a) => a.name === ref)
      if (agent) {
        const content = agent.body ?? agent.description ?? ""
        if (content) resolved.push({ kind: "agent", label: raw, content })
        return content || raw
      }
      return raw
    }
    if (k === "skill") {
      const skill = sources.skills.find((s) => s.name === ref)
      if (skill) {
        const content = skill.body ?? skill.description ?? ""
        if (content) resolved.push({ kind: "skill", label: raw, content })
        return content || raw
      }
      return raw
    }
    const content = mcpContents.get(raw)
    if (content) {
      resolved.push({ kind: "mcp", label: raw, content })
      return content
    }
    return raw
  })
  return out
}

/** Serve the built client UI with SPA fallback. Path traversal is blocked by
 *  requiring the resolved path to stay under root (root+sep compare). */
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" }
async function serveStatic(root: string, pathname: string): Promise<Response> {
  const rootAbs = resolve(root)
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1))
  const resolved = resolve(root, rel)
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + sep)) return json(403, { error: "forbidden" })
  // Hashed assets are immutable (cache forever); index.html must revalidate on
  // every load — a heuristic-cached shell pins stale bundle references and the
  // client keeps booting an old build until a hard refresh.
  const file = Bun.file(resolved)
  if (await file.exists()) {
    const ext = resolved.slice(resolved.lastIndexOf(".")).toLowerCase()
    const cache = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable"
    return new Response(file, { headers: { ...(CONTENT_TYPES[ext] ? { "content-type": CONTENT_TYPES[ext]! } : {}), "cache-control": cache } })
  }
  // SPA fallback: unknown extension-less paths load the app shell.
  if (!rel.includes(".")) {
    const index = Bun.file(join(rootAbs, "index.html"))
    if (await index.exists()) return new Response(index, { headers: { "content-type": CONTENT_TYPES[".html"]!, "cache-control": "no-cache" } })
  }
  return json(404, { error: "not found" })
}

/** SSE stream: one `data: {json}\n\n` per event; `[DONE]` at the end. */
function sseStream(): { stream: ReadableStream<Uint8Array>; emit: (payload: string) => void; close: () => void } {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      // Client disconnected (browser nav / network drop / curl abort). Further
      // enqueue/close must be a no-op, not a throw — an unhandled rejection in
      // the prompt .then() would crash the whole Bun process.
      closed = true
    },
  })
  return {
    stream,
    emit: (payload) => {
      if (closed) return
      try {
        controller.enqueue(encoder.encode(payload))
      } catch {
        closed = true
      }
    },
    close: () => {
      if (closed) return
      closed = true
      try {
        controller.close()
      } catch {
        // already closed by the client; no-op.
      }
    },
  }
}

export async function createServer(config: ServerConfig): Promise<ServerHandle> {
  const host = config.host ?? "127.0.0.1"
  const port = config.port ?? 3927
  const token = config.token
  const sessionResolver = config.sessionResolver
  const directory = config.directory
  const settings = config.settings
  const approvals = config.approvals
  const schedules = config.schedules
  const memory = config.memory
  const dagRunner = config.dagRunner
  const pluginsDir = config.pluginsDir
  const agentHome = config.agentHome
  const channels = config.channels
  const serverTools = config.tools
  const mcpResources = config.mcpResources
  const apps = new Map<string, App>()
  /** Sessions this process created (directory-owned; unregistered on stop). */
  const owned = new Set<string>()

  // Global event bus (GET /v1/events/stream, opencode's /api/event): one SSE
  // feed forwarding every attached session's LoopEvents so a UI keeps ONE live
  // connection instead of polling lists + tailing per-session streams. Each
  // attach() plants a permanent relay; global listeners come and go freely.
  // Listener errors are isolated — a broken SSE consumer never sinks a turn.
  // Frames carry LoopEvents plus the prompt-stream terminal `result` marker.
  type BusEvent = AppEvent | ({ type: "result" } & Record<string, unknown>)
  const globalListeners = new Set<(frame: { sessionId: string; event: BusEvent }) => void>()
  const relays = new Map<string, () => void>()
  const attach = (sessionId: string, app: App): void => {
    apps.set(sessionId, app)
    relays.get(sessionId)?.()
    relays.set(
      sessionId,
      app.onEvent((event) => {
        for (const l of globalListeners) {
          try {
            l({ sessionId, event })
          } catch {
            // isolated
          }
        }
      }),
    )
  }
  const detach = (sessionId: string): void => {
    const app = apps.get(sessionId)
    apps.delete(sessionId)
    relays.get(sessionId)?.()
    relays.delete(sessionId)
    // Kill the session's shared terminal shell — a detached session must not
    // leak a live child process.
    app?.terminalDispose()
    // Close the app's SQLite connection — a deleted session must not leak an
    // open Database handle (same discipline as the resolveApp conflict path).
    void (app?.events as { close?: () => void } | undefined)?.close?.()
  }

  /** The URL peers use to reach this server (advertised or derived). Trailing
   *  slashes are stripped so endpoint comparisons (stale-self guard) can't be
   *  defeated by spelling. */
  const selfUrl = (): string => (config.advertiseUrl ?? `http://${host}:${server.port}`).replace(/\/+$/, "")

  /** Independent liveness probe for a proxy failure: only a failed HEALTH
   *  CHECK (not a slow response, not our own client's disconnect) may sweep a
   *  directory row — the owner re-asserts its row on the next heartbeat tick
   *  anyway, but a wrong sweep would open a split-brain window. */
  async function ownerAlive(entry: DirectoryEntry): Promise<boolean> {
    try {
      const headers: Record<string, string> = {}
      if (token) headers.authorization = `Bearer ${token}`
      const res = await fetch(`${entry.endpoint}/v1/health`, { headers, signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }

  /** A directory row may only point at loopback — the shared SQLite file is
   *  writable by any local process, and proxying carries OUR bearer token to
   *  the endpoint. Cross-host clustering would need a separate cluster secret
   *  (not designed yet); refusing here closes the token-exfiltration path. */
  function proxyTargetAllowed(entry: DirectoryEntry): boolean {
    try {
      const h = new URL(entry.endpoint).hostname
      return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]"
    } catch {
      return false
    }
  }

  /** A resolved session: served locally, owned by a sibling process, or absent. */
  type Found = { kind: "local"; app: App } | { kind: "remote"; entry: DirectoryEntry } | { kind: "missing"; error: string }
  const findSession = async (sessionId: string): Promise<Found> => {
    const local = apps.get(sessionId)
    if (local) return { kind: "local", app: local }
    if (directory) {
      const entry = directory.lookup(sessionId)
      if (entry) {
        if (entry.endpoint === selfUrl()) {
          // Stale self-entry (we ARE that endpoint but hold no app — the owner
          // restarted). Sweep it rather than proxying to ourselves.
          directory.unregister(sessionId)
        } else if (proxyTargetAllowed(entry)) {
          return { kind: "remote", entry }
        } else {
          // Poisoned row (non-loopback endpoint): never proxy our token to it.
          directory.unregister(sessionId)
        }
      }
    }
    if (settings) {
      // Lazy re-attach: the session exists in the DURABLE registry but no App
      // is attached yet (server restart). Rebuild it from the row so history
      // stays readable and the conversation can continue after a restart.
      try {
        const db = new Database(join(settings.get().dataDir, "events.db"), { readonly: true })
        let row: { sessionId: string; workspace: string; model?: string; role?: "butler" } | undefined
        try {
          const registry = new SessionRegistry(new SqliteEventStore(db))
          row = (await registry.list()).find((r) => r.sessionId === sessionId)
        } finally {
          db.close()
        }
        if (row) {
          // Re-attach keeps the fixed role: a butler session must come back
          // with its coordinator toolset after a restart, not as a plain chat.
          const resolved = await resolveApp({ sessionId, workspace: row.workspace, model: row.model, asButler: row.role === "butler" })
          if (resolved?.app) {
            if (directory) {
              directory.register(sessionId, selfUrl())
              owned.add(sessionId)
            }
            return { kind: "local", app: resolved.app }
          }
        }
      } catch {
        // registry unavailable — fall through to the resolver/miss
      }
    }
    if (sessionResolver) {
      // A host-provided resolver may lazily re-attach sessions (from disk,
      // from another node, etc.) — cache the result to avoid repeated resolution.
      const resolved = await sessionResolver(sessionId)
      if (resolved) {
        attach(sessionId, resolved)
        // We now HOLD this session locally and the directory had no live row
        // — claim ownership so cross-process ops route here.
        if (directory) {
          directory.register(sessionId, selfUrl())
          owned.add(sessionId)
        }
        return { kind: "local", app: resolved }
      }
    }
    return { kind: "missing", error: `session "${sessionId}" not found` }
  }

  /** Proxy a JSON op to the owning server. Owner confirmed dead (health probe
   *  fails) → sweep the stale entry (self-healing directory) and report 502. */
  async function proxyJson(entry: DirectoryEntry, path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
    if (token) headers.authorization = `Bearer ${token}`
    try {
      const res = await fetch(entry.endpoint + path, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(5_000) })
      return new Response(await res.arrayBuffer(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } })
    } catch {
      if (!init?.signal?.aborted && !(await ownerAlive(entry))) {
        directory?.unregister(entry.sessionId)
        return json(502, { error: `owner ${entry.endpoint} unreachable for session "${entry.sessionId}" (stale entry swept)` })
      }
      return json(502, { error: `owner ${entry.endpoint} unreachable for session "${entry.sessionId}"` })
    }
  }

  /** Proxy the SSE prompt stream: relay the owner's event stream verbatim.
   *  The client's own disconnect (signal aborted) is NOT an owner failure —
   *  never sweep for it. */
  async function proxyPrompt(entry: DirectoryEntry, sessionId: string, body: string, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (token) headers.authorization = `Bearer ${token}`
    try {
      const res = await fetch(`${entry.endpoint}/v1/session/${sessionId}/prompt`, { method: "POST", headers, body, signal })
      return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "text/event-stream" } })
    } catch {
      if (!signal?.aborted && !(await ownerAlive(entry))) {
        directory?.unregister(entry.sessionId)
        return json(502, { error: `owner ${entry.endpoint} unreachable for session "${entry.sessionId}" (stale entry swept)` })
      }
      return json(502, { error: `owner ${entry.endpoint} unreachable for session "${entry.sessionId}"` })
    }
  }
  const sessionConfig = config.sessionConfig

  type ResolveResult = { app: App; conflict?: undefined } | { app?: undefined; conflict: DirectoryEntry } | undefined

  /** Build (or return cached) an App for a session id. */
  async function resolveApp(create: SessionCreateRequest): Promise<ResolveResult> {
    const id = create.sessionId ?? crypto.randomUUID()
    const existing = apps.get(id)
    if (existing) {
      // Re-assert ownership on a local hit (idempotent, refreshes heartbeat):
      // a proxy blip may have swept our row while the session is alive HERE —
      // restoring it keeps the owner-only-writer invariant honest (only the
      // holder writes its row).
      if (directory) {
        directory.register(id, selfUrl())
        owned.add(id)
      }
      return { app: existing }
    }
    if (!sessionConfig) return undefined
    const base = await sessionConfig({ ...create })
    // sessionId must be pinned, else createApp derives a workspace-stable id
    // that differs from the one the caller will use in paths.
    // Transport-level extra tools (mounted MCP servers) merge ADDITIVELY after
    // the session factory's own tools — runtime precedence (first same-name
    // occurrence wins, builtins last) resolves collisions deterministically.
    const app = await createApp({ ...base, sessionId: id, onApprove: config.onApprove ?? config.approvals?.gate, ...(config.approvals ? { onAsk: (q: { question: string; options?: readonly string[]; sessionId?: string; promptId?: string; tool?: string; callId?: string }) => config.approvals!.ask({ id: crypto.randomUUID(), kind: "question", target: q.question, decision: "prompt", ...(q.options ? { options: q.options } : {}), ...(q.sessionId ? { sessionId: q.sessionId } : {}), ...(q.promptId ? { promptId: q.promptId } : {}), ...(q.tool ? { tool: q.tool } : {}), ...(q.callId ? { callId: q.callId } : {}) }) } : {}), ...(serverTools?.length ? { tools: [...(base.tools ?? []), ...serverTools] } : {}) })
    if (directory) {
      // Register cross-process ownership. register returns the PREVIOUS row:
      // a foreign FRESH row means a sibling owns this id and our pre-check
      // raced — give the row back, discard the local App (two Apps must never
      // drive one log) and report the conflict. A STALE foreign row (dead
      // owner past the heartbeat window) is a legitimate takeover.
      const previous = directory.register(id, selfUrl())
      if (previous && previous.endpoint !== selfUrl() && Date.now() - previous.heartbeatAt < 30_000) {
        directory.register(id, previous.endpoint, previous.pid)
        void (app.events as { close?: () => void }).close?.()
        return { conflict: previous }
      }
      owned.add(id)
    }
    attach(id, app)
    return { app }
  }

  /** SSE prompt: subscribe once, stream loop events, then result + [DONE].
   *  Client disconnect (req.signal) interrupts the app so the stream shuts
   *  down cleanly instead of leaving a half-open SSE connection — Bun's
   *  server.stop() would otherwise crash on a pending disconnected stream. */
  let inFlight = 0
  async function promptStream(app: App, text: string, principal?: "user" | "butler" | "parent", signal?: AbortSignal, images?: { mime: string; data: string }[], opts?: { replace?: boolean }, promptId?: string): Promise<Response> {
    inFlight++
    const sse = sseStream()
    // Flush headers NOW with an SSE comment line: Bun does not send response
    // headers until the first body byte, and a turn can go quiet for a long
    // time (hung LLM, long tool) — clients and cross-process proxies must see
    // the 200 immediately, not at the first event.
    sse.emit(": open\n\n")
    // Keepalive comments every 15s: a turn running a long tool emits no
    // events, and an idle socket would be dropped (Bun default 10s). Comment
    // lines are ignored by every SSE client, so they are safe between events.
    const keepalive = setInterval(() => sse.emit(": keepalive\n\n"), 15_000)
    const unsubscribe = app.onEvent((event) => {
      sse.emit(`data: ${JSON.stringify(event)}\n\n`)
    })
    // Terminal frames also ride the global bus: a turn that fails at the LLM
    // call throws WITHOUT a LoopEvent (only the prompt stream would know) —
    // forward result/error so bus consumers see the settle either way.
    const emitGlobal = (event: BusEvent): void => {
      for (const l of globalListeners) {
        try {
          l({ sessionId: app.sessionId, event })
        } catch {
          // isolated
        }
      }
    }
    // Client went away -> close the SSE stream only. The run continues in the
    // background until it naturally completes or is explicitly interrupted.
    const onAbort = (): void => {
      sse.close()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    app
      .prompt(text, principal, images, { ...opts, ...(promptId ? { promptId } : {}) })
      .then((result) => {
        emitGlobal({ type: "result", ...result })
        sse.emit(`data: ${JSON.stringify({ type: "result", ...result })}\n\n`)
        sse.emit(`data: [DONE]\n\n`)
        sse.close()
      })
      .catch((err: unknown) => {
        const event: AppEvent = { type: "error", code: "server", message: err instanceof Error ? err.message : String(err) }
        emitGlobal(event)
        sse.emit(`data: ${JSON.stringify(event)}\n\n`)
        sse.emit(`data: [DONE]\n\n`)
        sse.close()
      })
      .finally(() => {
        inFlight--
        clearInterval(keepalive)
        signal?.removeEventListener("abort", onAbort)
        unsubscribe()
      })
    return new Response(sse.stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
  }

  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: config.idleTimeout ?? 120,
    async fetch(req) {
      const url = new URL(req.url)
      const parts = url.pathname.split("/").filter(Boolean)
      // Token gate (constant-time) — API ONLY: the static shell (index.html +
      // assets) must load without a token so a remote device can reach the
      // page and enter its token there (the token then rides every /v1 call
      // as Bearer). Without a token, only loopback binds at all.
      const isApi = parts[0] === "v1"
      // Loopback is trusted by default: the desktop shell and the browser on
      // the same machine never need to enter the LAN token (a 401 on localhost
      // after a host=tokened upgrade would break every existing client). The
      // token guards REMOTE (LAN/phone) callers only.
      const hostHeader = req.headers.get("host") ?? ""
      const fromLoopback = hostHeader.startsWith("127.0.0.1") || hostHeader.startsWith("localhost") || hostHeader.startsWith("[::1]")
      if (token) {
        if (isApi && !fromLoopback && !constantTimeEqual(bearer(req) ?? "", token)) return json(401, { error: "unauthorized" })
      } else if (host !== "127.0.0.1" && host !== "::1" && !fromLoopback) {
        return json(403, { error: "loopback-only (no token; bind 127.0.0.1 or provide token)" })
      }

      const method = req.method
      // The built client UI (SPA) — one origin with the API.
      if (parts[0] !== "v1") {
        if (config.uiDir && method === "GET") return serveStatic(config.uiDir, url.pathname)
        return json(404, { error: "not found" })
      }

      // GET /v1/health
      if (method === "GET" && parts.length === 2 && parts[1] === "health") {
        return json(200, { status: "ok" })
      }

      // POST /v1/session
      if (method === "POST" && parts.length === 2 && parts[1] === "session") {
        const parsed = await readJsonOr400<SessionCreateRequest>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        // Split-brain guard: an explicit id that a SIBLING process owns must
        // not be re-created locally (two Apps would drive one log). The
        // register-time takeover check in resolveApp closes the remaining
        // check-then-act race.
        if (parsed.sessionId && directory) {
          const entry = directory.lookup(parsed.sessionId)
          if (entry && entry.endpoint !== selfUrl() && Date.now() - entry.heartbeatAt < 30_000) return json(409, { error: `session "${parsed.sessionId}" is owned by ${entry.endpoint}` })
        }
        // A session's workspace must EXIST on disk: the fs tools and the bash
        // terminal pin their cwd there, and a nonexistent cwd makes spawn fail
        // with ENOENT. A UI "new project" may point at a not-yet-created dir —
        // create it so files browse + terminal both work (mkdir -p semantics).
        if (parsed.workspace) {
          try {
            await mkdir(parsed.workspace, { recursive: true })
          } catch {
            // Unwritable/odd path — let the app-level error surface honestly.
          }
        }
        const resolved = await resolveApp(parsed)
        if (!resolved) return json(500, { error: "no sessionConfig provided; cannot create session" })
        if (resolved.conflict) return json(409, { error: `session "${parsed.sessionId}" is owned by ${resolved.conflict.endpoint}` })
        const session = await resolved.app.resume()
        return json(201, { sessionId: resolved.app.sessionId, messageCount: session.messages.length, headSeq: session.headSeq })
      }

      // POST /v1/session/:id/prompt — {text, principal?, images?: [{mime,data}]}.
      // Shape + caps are validated here so one bad paste can never poison the
      // append-only log or balloon a provider request. An image-only prompt
      // (empty text) is valid.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "prompt") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        // Bound the buffered read BEFORE parsing: the caps below bound what is
        // LOGGED, not what a hostile body could make us buffer.
        const parsed = await readJsonOr400<{ text?: string; principal?: "user" | "butler" | "parent"; images?: { mime?: string; data?: string }[]; replace?: boolean; promptId?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const images: { mime: string; data: string }[] = []
        for (const img of parsed.images ?? []) {
          if (images.length >= MAX_IMAGES_PER_PROMPT) return json(400, { error: `too many images (max ${MAX_IMAGES_PER_PROMPT})` })
          if (!img.mime || !/^image\/(png|jpeg|webp|gif)$/.test(img.mime)) return json(400, { error: `unsupported image type: ${img.mime ?? "(none)"}` })
          if (!img.data || img.data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data) || img.data.length % 4 !== 0) return json(400, { error: "invalid image payload (not base64 or over the size cap)" })
          images.push({ mime: img.mime, data: img.data })
        }
        if (!parsed.text && images.length === 0) return json(400, { error: "text or images required" })
        if (found.kind === "remote") return proxyPrompt(found.entry, parts[2]!, JSON.stringify({ text: parsed.text ?? "", principal: parsed.principal, ...(images.length ? { images } : {}), replace: parsed.replace, promptId: parsed.promptId }), req.signal)
        return promptStream(found.app, parsed.text ?? "", parsed.principal, req.signal, images, parsed.replace ? { replace: true } : undefined, parsed.promptId)
      }

      // POST /v1/session/:id/steer
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "steer") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        const parsed = await readJsonOr400<{ text?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.text) return json(400, { error: "text is required" })
        if (found.kind === "remote") return proxyJson(found.entry, `/v1/session/${parts[2]!}/steer`, { method: "POST", body: JSON.stringify({ text: parsed.text }) })
        await found.app.steer(parsed.text)
        return json(200, { admitted: true })
      }

      // POST /v1/session/:id/exec {command} — the workbench terminal: ONE
      // command through the session's own bash tool + exec policy + approval
      // gate (the operator's seat at the agent's console, same rules).
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "exec") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        const parsed = await readJsonOr400<{ command?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.command?.trim()) return json(400, { error: "command is required" })
        if (found.kind === "remote") return proxyJson(found.entry, `/v1/session/${parts[2]!}/exec`, { method: "POST", body: JSON.stringify({ command: parsed.command }), signal: req.signal })
        const result = await found.app.exec(parsed.command.trim(), req.signal)
        return json(200, { result })
      }

      // POST /v1/session/:id/interrupt
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "interrupt") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return proxyJson(found.entry, `/v1/session/${parts[2]!}/interrupt`, { method: "POST" })
        found.app.interrupt()
        return json(200, { interrupted: true })
      }

      // POST /v1/session/:id/terminal {input, mode?} — the HUMAN half of the
      // shared workbench terminal: a full command line ("command", default) or
      // raw keystrokes ("raw", e.g. ^C) into the same persistent shell the
      // agent's terminal_send/terminal_read tools drive.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "terminal") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "shared terminal on a remote-owned session is not proxied yet" })
        const parsed = await readJsonOr400<{ input?: string; mode?: "command" | "raw" }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.input) return json(400, { error: "input is required" })
        found.app.terminalWrite(parsed.input, parsed.mode === "raw" ? "raw" : "command")
        return json(200, { accepted: true })
      }

      // GET /v1/session/:id/terminal?since=N — incremental shared-terminal
      // output + the human/agent activity ledger for the web terminal view.
      if (method === "GET" && parts.length === 4 && parts[1] === "session" && parts[3] === "terminal") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "shared terminal on a remote-owned session is not proxied yet" })
        const since = Number(url.searchParams.get("since") ?? "0")
        const r = found.app.terminalRead(Number.isFinite(since) ? since : 0)
        return json(200, r)
      }

      // GET /v1/models/catalog — the model capability catalog (reference data
      // for the client's model-config UI: pick a model → budgets autofill).
      // Reference-only: routing reads AgentHomeConfig, never this file.
      // NOTE: must sit ABOVE the catch-all "GET /v1/session/:id" route (that
      // route matches any 3-segment GET path).
      if (method === "GET" && parts.length === 3 && parts[1] === "models" && parts[2] === "catalog") {
        const catalog = agentHome ? await loadModelCatalog(agentHome) : null
        return json(200, { catalog })
      }

      // GET /v1/providers — redacted provider/profile view for the client:
      // ids, kinds, endpoints, model/budget metadata and hasApiKey presence.
      // NEVER returns apiKey/header/env values. Read-only; routing still reads
      // the settings layer directly.
      if (method === "GET" && parts.length === 2 && parts[1] === "providers") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        const effective = settings.get()
        const redacted = redactSettings(effective)
        return json(200, {
          activeProviderId: redacted.activeProviderId,
          providers: redacted.providers ?? [],
          provider: redacted.provider,
          model: redacted.model,
        })
      }

      // POST /v1/channel/:id/inbound — an external channel message becomes an
      // ordinary prompt on the channel's bound (resident) session. Same durable
      // admission path as human prompts; the settled reply is POSTed to the
      // channel webhook when configured (side channel — failures never
      // corrupt the settled turn).
      if (method === "POST" && parts.length === 4 && parts[1] === "channel" && parts[3] === "inbound") {
        const cfg = channels?.find((c) => c.id === parts[2]!)
        if (!cfg) return json(404, { error: `unknown channel "${parts[2]}"` })
        const parsed = await readJsonOr400<{ text?: string; userId?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        try {
          const result = await handleChannelInbound({
            config: cfg,
            prompt: async (sessionId, text) => {
              // Resolve-or-create through the SAME path as POST /v1/session
              // (cross-process split-brain guard included).
              const resolved = await resolveApp({ sessionId })
              if (!resolved) throw new Error("no sessionConfig provided; cannot create session")
              if (resolved.conflict) throw new Error(`session "${sessionId}" is owned by ${resolved.conflict.endpoint}`)
              // One runSession loop per log: an overlapping inbound (webhook
              // redelivery) is rejected, not queued — the caller retries.
              if (resolved.app.isBusy()) throw new Error("session busy")
              const run = await resolved.app.prompt(text, "user")
              const session = await resolved.app.resume()
              const lastAssistant = [...session.messages].reverse().find((m) => m.kind === "assistant")
              const reply = lastAssistant && lastAssistant.kind === "assistant"
                ? lastAssistant.content.filter((p) => p.type === "text").map((p) => (p as { text?: string }).text ?? "").join("")
                : ""
              return { finish: run.finish, reply }
            },
            fetchImpl: config.modelsFetch ?? fetch,
          }, { text: parsed.text ?? "", userId: parsed.userId })
          return json(200, result)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (message.includes("disabled")) return json(409, { error: message })
          return json(400, { error: message })
        }
      }

      // GET /v1/session/:id — MUST pin parts[1]: a bare length check would
      // swallow every other 3-segment GET (/v1/events/stream, /v1/dag/:id).
      if (method === "GET" && parts.length === 3 && parts[1] === "session") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return proxyJson(found.entry, `/v1/session/${parts[2]!}`)
        // Session is serializable; its snapshot (messages/headSeq) is the API shape.
        const session = await found.app.resume()
        return json(200, session.snapshot())
      }

      // GET /v1/live — the cross-process directory view (who owns what).
      if (method === "GET" && parts.length === 2 && parts[1] === "live") {
        return json(200, { self: selfUrl(), live: directory?.entries() ?? [] })
      }

      // GET /v1/sessions — the DURABLE registry (survives restarts) when a
      // settings surface gives us the dataDir; otherwise the in-memory apps.
      if (method === "GET" && parts.length === 2 && parts[1] === "sessions") {
        const ws = url.searchParams.get("workspace") ?? undefined
        const st = url.searchParams.get("status") ?? undefined
        const pid = url.searchParams.get("parentId") ?? undefined
        const exCh = url.searchParams.get("excludeChildren")
        const proj = url.searchParams.get("projectId") ?? undefined
        const query: RegistryQuery | undefined = ws || st || pid || exCh !== null || proj
          ? {
              ...(ws ? { workspace: ws } : {}),
              ...(st ? { status: st as RegistryQuery["status"] } : {}),
              ...(pid ? { parentId: pid } : {}),
              ...(exCh !== null ? { excludeChildren: exCh !== "false" } : {}),
              ...(proj ? { projectId: proj } : {}),
            }
          : undefined
        if (settings) {
          try {
            const db = new Database(join(settings.get().dataDir, "events.db"), { readonly: true })
            try {
              const store = new SqliteEventStore(db)
              const registry = new SessionRegistry(store)
              const rows = await registry.list(query)
              return json(200, rows)
            } finally {
              db.close()
            }
          } catch {
            // no events.db yet — fall through to the in-memory view
          }
        }
        const rows: SessionRow[] = []
        for (const app of apps.values()) rows.push(...(await app.listSessions(query)))
        const seen = new Set<string>()
        return json(200, rows.filter((r) => !seen.has(r.sessionId) && seen.add(r.sessionId)))
      }

      // GET /v1/audit
      if (method === "GET" && parts.length === 2 && parts[1] === "audit") {
        const actor = url.searchParams.get("actorSessionId") ?? undefined
        const rows: AuditEventRow[] = []
        for (const app of apps.values()) rows.push(...(await app.audit(actor)))
        return json(200, rows)
      }

      // GET /v1/session/:id/events
      // GET /v1/events/stream — global event bus: one SSE for ALL locally
      // attached sessions, frames envelope `{sessionId, event}`. Remote-owned
      // sessions are not forwarded (same scope as the per-session stream).
      if (method === "GET" && parts.length === 3 && parts[1] === "events" && parts[2] === "stream") {
        const encoder = new TextEncoder()
        const body = new ReadableStream({
          start(controller) {
            let closed = false
            const send = (data: string) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(data))
              } catch {
                closed = true
              }
            }
            send(": open\n\n")
            const listener = (frame: { sessionId: string; event: BusEvent }): void => send(`data: ${JSON.stringify(frame)}\n\n`)
            globalListeners.add(listener)
            const keepalive = setInterval(() => send(": keepalive\n\n"), 15_000)
            req.signal.addEventListener("abort", () => {
              closed = true
              clearInterval(keepalive)
              globalListeners.delete(listener)
              try {
                controller.close()
              } catch {
                // already closed
              }
            })
          },
        })
        return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
      }

      // GET /v1/session/:id/events/stream — live event subscription (wave 12):
      // SSE over app.onEvent; `: open` first (Bun flushes headers on the first
      // body byte), 15s keepalive comments, ends when the client disconnects.
      // Clients load GET /events for history, then stream this for the live tail.
      if (method === "GET" && parts.length === 5 && parts[1] === "session" && parts[3] === "events" && parts[4] === "stream") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "event streaming on a remote-owned session is not proxied yet" })
        const app = found.app
        const encoder = new TextEncoder()
        const body = new ReadableStream({
          start(controller) {
            let closed = false
            const send = (data: string) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(data))
              } catch {
                closed = true
              }
            }
            send(": open\n\n")
            const unsub = app.onEvent((event) => send(`data: ${JSON.stringify(event)}\n\n`))
            const keepalive = setInterval(() => send(": keepalive\n\n"), 15_000)
            req.signal.addEventListener("abort", () => {
              closed = true
              clearInterval(keepalive)
              unsub()
              try {
                controller.close()
              } catch {
                // already closed
              }
            })
          },
        })
        return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
      }

      if (method === "GET" && parts.length === 4 && parts[1] === "session" && parts[3] === "events") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return proxyJson(found.entry, `/v1/session/${parts[2]!}/events`)
        let events: StoredEvent[] = await found.app.events.read(parts[2]!)
        // Attachment-ref hydration (docs §5): the log stores sha256 refs; the
        // API response re-materializes `images` so clients keep one shape.
        if (found.app.attachments) {
          const store = found.app.attachments
          events = await Promise.all(events.map(async (e) => {
            // Only PromptAdmitted carries refs (Prompted resolves by id at fold
            // time and never duplicates them).
            if (e.type !== "Session.PromptAdmitted") return e
            const refs = (e.data as { attachments?: Array<{ sha256: string; mime: string }> }).attachments
            if (!refs?.length) return e
            const images: Array<{ mime: string; data: string }> = []
            for (const ref of refs) {
              const stored = await store.get(ref.sha256)
              if (stored) images.push({ mime: ref.mime, data: Buffer.from(stored.bytes).toString("base64") })
            }
            return { ...e, data: { ...e.data, images } }
          }))
        }
        return json(200, events)
      }

      // --- client-facing surfaces (settings / models / approvals / usage / schedules) ---

      // GET /v1/memory?q=&type=&sort= — the client's memory browser.
      if (method === "GET" && parts.length === 2 && parts[1] === "memory") {
        if (!memory) return json(404, { error: "no memory store configured" })
        const q = url.searchParams.get("q") ?? ""
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)))
        const type = url.searchParams.get("type")
        const sort = url.searchParams.get("sort")
        let rows: MemoryRecord[] = await memory.search(q, type ? limit * 3 : limit)
        if (type) rows = rows.filter((r) => r.type === type).slice(0, limit)
        if (sort === "priority") rows = [...rows].sort((a, b) => b.priority - a.priority)
        if (sort === "latest") rows = [...rows].sort((a, b) => b.createdAt - a.createdAt)
        return json(200, { memories: rows })
      }

      // DELETE /v1/memory/:id — remove one memory.
      if (method === "DELETE" && parts.length === 3 && parts[1] === "memory") {
        if (!memory) return json(404, { error: "no memory store configured" })
        if (!memory.delete) return json(501, { error: "memory store does not support delete" })
        await memory.delete(parts[2]!)
        return json(200, { removed: true })
      }

      // --- 编排 (DAG) ---
      // POST /v1/dag {spec, workspace?, todoSessionId?} — declare + run (fire-and-forget).
      if (method === "POST" && parts.length === 2 && parts[1] === "dag") {
        if (!dagRunner) return json(404, { error: "no dag runner configured" })
        const parsed = await readJsonOr400<{ spec?: DAGSpec; workspace?: string; todoSessionId?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.spec || typeof parsed.spec !== "object" || !parsed.spec.nodes || Object.keys(parsed.spec.nodes).length === 0) return json(400, { error: "spec.nodes is required (at least one node)" })
        // Synchronous preflight: a malformed graph (cycle / unknown dep / self
        // dep / dangling entry) would otherwise return 201 dagId and fail
        // fire-and-forget AFTER the caller already saw success. Validate NOW.
        try {
          validateDag(parsed.spec)
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : String(e) })
        }
        try {
          const { dagId } = await dagRunner.run(parsed.spec, { workspace: parsed.workspace, todoSessionId: parsed.todoSessionId })
          return json(201, { dagId })
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : String(e) })
        }
      }

      // GET /v1/dags — all declared DAGs (durable fold).
      if (method === "GET" && parts.length === 2 && parts[1] === "dags") {
        if (!dagRunner) return json(404, { error: "no dag runner configured" })
        return json(200, { dags: await dagRunner.list() })
      }

      // GET /v1/dag/:id — node statuses for one DAG.
      if (method === "GET" && parts.length === 3 && parts[1] === "dag") {
        if (!dagRunner) return json(404, { error: "no dag runner configured" })
        const st = await dagRunner.status(parts[2]!)
        return st ? json(200, st) : json(404, { error: "unknown dag id" })
      }

      // POST /v1/dag/:id/abort — abort a running graph (durable DAG.Aborted;
      // pending→skipped, running→aborted). An already-done graph is a 200 with
      // {aborted:false}; an unknown id is a 404.
      if (method === "POST" && parts.length === 4 && parts[1] === "dag" && parts[3] === "abort") {
        if (!dagRunner) return json(404, { error: "no dag runner configured" })
        try {
          return json(200, await dagRunner.abort(parts[2]!))
        } catch {
          return json(404, { error: "unknown dag id" })
        }
      }

      // GET /v1/session/:id/goal — folded goal + persisted usage.
      if (method === "GET" && parts.length === 4 && parts[1] === "session" && parts[3] === "goal") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        const events = (found.kind === "local" ? await found.app.events.read(parts[2]!) : await (await fetch(`${found.entry.endpoint}/v1/session/${parts[2]!}/events`, { headers: token ? { authorization: `Bearer ${token}` } : {} })).json()) as StoredEvent[]
        const goal = currentGoal(events)
        return json(200, { goal: goal ?? null, tokensUsed: foldTokensUsed(events) })
      }

      // POST /v1/session/:id/goal {objective, tokenBudget?} — durable goal write.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "goal") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "goal write on a remote-owned session is not proxied yet" })
        const parsed = await readJsonOr400<{ objective?: string; tokenBudget?: number }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const valid = validateGoal(parsed.objective, "active", parsed.tokenBudget)
        if ("error" in valid) return json(400, { error: valid.error })
        await found.app.events.append(parts[2]!, "Session.GoalUpdated", { sessionId: parts[2]!, objective: valid.objective, status: "active", ...(valid.tokenBudget !== undefined ? { tokenBudget: valid.tokenBudget } : {}), ts: Date.now() })
        return json(201, { objective: valid.objective, tokenBudget: valid.tokenBudget ?? null })
      }

      // GET /v1/session/:id/todos — the current durable task list.
      if (method === "GET" && parts.length === 4 && parts[1] === "session" && parts[3] === "todos") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        const events = (found.kind === "local" ? await found.app.events.read(parts[2]!) : await (await fetch(`${found.entry.endpoint}/v1/session/${parts[2]!}/events`, { headers: token ? { authorization: `Bearer ${token}` } : {} })).json()) as StoredEvent[]
        return json(200, { todos: currentTodos(events) })
      }

      // GET /v1/session/:id/context — visible context size vs the window, PLUS
      // the real token accounting folded from the session's ModelCalled events
      // (input/output/cache/reasoning), the active model + provider identity,
      // and the compaction state. The previous view was a char estimate only —
      // cache hits / reasoning spend live in usage and were never surfaced.
      if (method === "GET" && parts.length === 4 && parts[1] === "session" && parts[3] === "context") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        const events = (found.kind === "local" ? await found.app.events.read(parts[2]!) : await (await fetch(`${found.entry.endpoint}/v1/session/${parts[2]!}/events`, { headers: token ? { authorization: `Bearer ${token}` } : {} })).json()) as StoredEvent[]
        const settingsNow = settings?.get()
        const windowTokens = settingsNow?.contextWindowTokens
        // Mirror the loop's model-visible view: the microcompact projection
        // clears old tool results once over the compaction trigger, so the
        // reported size must reflect what the model actually receives.
        const cpt = settingsNow?.charsPerToken ?? 2.5
        const limit = compactLimit({ contextWindowTokens: windowTokens, charsPerToken: cpt })
        const { messages: projected, boundary } = projectCompacted(events)
        const visible = clearStaleToolResults(projected, { thresholdChars: limit, visibleChars: projected.reduce((n, m) => n + JSON.stringify(m).length, 0) })
        const chars = visible.reduce((n, m) => n + JSON.stringify(m).length, 0)
        const estTokens = Math.ceil(chars / cpt)
        // Fold real usage from every ModelCalled the session made. usage is a
        // raw passthrough (cache/reasoning are subsets of input/output, so we
        // report them alongside, not double-counted in the estimate).
        let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, reasoningTokens = 0, calls = 0
        let lastModel: string | undefined, lastProviderId: string | undefined
        let compactedAt: number | undefined
        // Cache-hit semantics differ by protocol origin: anthropic reports
        // cache_read as DISJOINT from input_tokens (input = plain only), while
        // openai-style providers (MiniMax M3 included) report cached_tokens as a
        // SUBSET that is already inside prompt_tokens. Summing both kinds into
        // one denominator would double-count the cached half of openai calls and
        // halve the reported hit rate (43% instead of ~90%+). Track them apart.
        let plainInputAnthropic = 0, cacheReadAnthropic = 0
        let plainInputOpenai = 0, cacheReadOpenai = 0
        for (const e of events) {
          if (e.type === "Session.ModelCalled") {
            const d = e.data as { model?: string; providerId?: string; source?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } }
            calls++
            lastModel = d.model
            lastProviderId = d.providerId
            const u = d.usage
            if (u) {
              inputTokens += u.inputTokens ?? 0
              outputTokens += u.outputTokens ?? 0
              cacheReadTokens += u.cacheReadTokens ?? 0
              cacheWriteTokens += u.cacheWriteTokens ?? 0
              reasoningTokens += u.reasoningTokens ?? 0
              const isAnthropic = d.providerId === "anthropic"
              const plain = u.inputTokens ?? 0
              const cached = u.cacheReadTokens ?? 0
              if (isAnthropic) {
                plainInputAnthropic += plain
                cacheReadAnthropic += cached
              } else {
                plainInputOpenai += plain
                cacheReadOpenai += cached
              }
            }
          } else if (e.type === "Session.Compacted" && e.ts) {
            compactedAt = Math.max(compactedAt ?? 0, e.ts)
          }
        }
        // Weighted hit rate: each call family uses its own denominator
        // (anthropic: cached/(plain+cached); openai: cached/plain because the
        // cached tokens are already part of plain). The two families are never
        // mixed in one rate.
        const anInputSide = plainInputAnthropic + cacheReadAnthropic
        const oaInputSide = plainInputOpenai
        const anRate = anInputSide > 0 ? cacheReadAnthropic / anInputSide : undefined
        const oaRate = oaInputSide > 0 ? cacheReadOpenai / oaInputSide : undefined
        const avgCacheHitRate = anRate !== undefined && oaRate !== undefined
          ? (anRate + oaRate) / 2
          : anRate ?? oaRate
        // Window size: explicit setting first, else the model catalog's entry
        // for the active model (a configured model should never show "0%").
        let effectiveWindow = windowTokens
        if (!effectiveWindow && lastModel && agentHome) {
          try {
            const cat = await loadModelCatalog(agentHome)
            effectiveWindow = cat?.providers.flatMap((p) => p.models).find((m) => m.id === lastModel)?.contextWindowTokens
          } catch {
            // catalog load failure — stay unknown rather than guessing
          }
        }
        const ratioOut = effectiveWindow ? Math.min(1, estTokens / (effectiveWindow * 0.6)) : undefined
        // Composition breakdown (same chars-per-token as the estimate).
        let breakdown: { systemPromptTokens: number; messagesTokens: number; builtinToolsTokens: number; mcpToolsTokens: number; otherTokens: number } | undefined
        if (found.kind === "local") {
          try {
            const b = await found.app.contextBreakdown()
            const toks = (chars: number) => Math.ceil(chars / cpt)
            breakdown = {
              systemPromptTokens: toks(b.systemPromptChars),
              messagesTokens: toks(b.messagesChars),
              builtinToolsTokens: toks(b.builtinToolsChars),
              mcpToolsTokens: toks(b.mcpToolsChars),
              otherTokens: toks(b.otherChars),
            }
          } catch {
            // breakdown is enrichment; the base view still serves
          }
        }
        return json(200, {
          chars,
          estTokens,
          ...(effectiveWindow ? { windowTokens: effectiveWindow, ratio: ratioOut } : {}),
          calls,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          reasoningTokens,
          ...(avgCacheHitRate !== undefined ? { avgCacheHitRate } : {}),
          ...(lastModel ? { model: lastModel } : {}),
          ...(lastProviderId ? { providerId: lastProviderId } : {}),
          compacted: compactedAt !== undefined,
          ...(compactedAt ? { compactedAt } : {}),
          ...(boundary >= 0 ? { compactedSeq: boundary } : {}),
          ...(breakdown ? { breakdown } : {}),
        })
      }

      // POST /v1/memory {content, type?, priority?} — client-side memory write.
      if (method === "POST" && parts.length === 2 && parts[1] === "memory") {
        if (!memory) return json(404, { error: "no memory store configured" })
        const parsed = await readJsonOr400<{ content?: string; type?: string; priority?: number }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.content?.trim()) return json(400, { error: "content is required" })
        const rec = await memory.write({ content: parsed.content.trim(), type: (parsed.type as "fact") ?? "fact", priority: parsed.priority ?? 50, sessionId: "client" })
        return json(201, rec)
      }

      // DELETE /v1/session/:id — hard delete (user-requested; archive is the
      // soft path). Owner-only: remote-owned sessions are not proxied. The
      // aggregate's whole event stream is removed from the store.
      if (method === "DELETE" && parts.length === 3 && parts[1] === "session") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "delete on a remote-owned session is not proxied yet" })
        found.app.interrupt()
        await found.app.events.delete(parts[2]!)
        detach(parts[2]!)
        directory?.unregister(parts[2]!)
        owned.delete(parts[2]!)
        return json(200, { deleted: true })
      }

      // POST /v1/session/:id/archive {archived} — archive/unarchive a session.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "archive") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "archive on a remote-owned session is not proxied yet" })
        const parsed = await readJsonOr400<{ archived?: boolean }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const archived = parsed.archived !== false
        await found.app.events.append(parts[2]!, "Session.Archived", { sessionId: parts[2]!, archived, ts: Date.now() })
        return json(200, { archived })
      }

      // POST /v1/session/:id/title {title} — durable rename (Session.TitleSet).
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "title") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "rename on a remote-owned session is not proxied yet" })
        const parsed = await readJsonOr400<{ title?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const title = parsed.title?.trim()
        if (!title) return json(400, { error: "title is required" })
        await found.app.events.append(parts[2]!, "Session.TitleSet", { sessionId: parts[2]!, title, ts: Date.now() })
        return json(200, { title })
      }

      // POST /v1/session/:id/fork {atSeq?} — branch at a message boundary
      // (codex backtrack: append-only fork, never truncate). The child
      // re-Creates with the SOURCE's workspace (a fork is the same project —
      // `location: ""` would leave it working blind) and its fixed role.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "fork") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "fork of a remote-owned session is not proxied yet" })
        const parsed = await readJsonOr400<{ atSeq?: number }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const source = await found.app.events.read(parts[2]!)
        const atSeq = parsed.atSeq !== undefined ? parsed.atSeq : Number.MAX_SAFE_INTEGER
        const created = source.find((e) => e.type === "Session.Created")
        const sourceData = (created?.data ?? {}) as { location?: string; role?: "butler" }
        const prefix = source.filter((e) => e.seq <= atSeq && e.type !== "Session.Created")
        if (prefix.length === 0) return json(400, { error: "nothing to fork at that seq" })
        const newId = crypto.randomUUID()
        for (const e of prefix) {
          await found.app.events.append(newId, e.type, e.data)
        }
        await found.app.events.append(newId, "Session.Created", {
          id: newId,
          location: sourceData.location ?? "",
          createdAt: Date.now(),
          ...(sourceData.role ? { role: sourceData.role } : {}),
        })
        return json(201, { sessionId: newId, forkedFrom: parts[2]!, atSeq: Math.min(atSeq, prefix[prefix.length - 1]!.seq) })
      }

      // POST /v1/session/:id/model {model} — per-session model switch
      // (Session.ModelSet). Takes effect on the NEXT prompt of THIS session.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "model") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "model switch on a remote-owned session is not proxied yet" })
        const parsed = await readJsonOr400<{ model?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.model?.trim()) return json(400, { error: "model is required" })
        try {
          await found.app.setModel(parsed.model.trim())
          return json(200, { model: parsed.model.trim() })
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : String(e) })
        }
      }

      // POST /v1/session/:id/truncate {atSeq} — in-place rewind (user "回退"):
      // removes every durable event past atSeq so the session replays as if later
      // turns never happened (Session.Truncated boundary). Destructive — the
      // caller (UI) confirms before invoking. Refuses a malformed boundary.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "truncate") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "truncate on a remote-owned session is not proxied yet" })
        const parsed = await readJsonOr400<{ atSeq?: number }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const atSeq = parsed.atSeq
        if (typeof atSeq !== "number" || !Number.isInteger(atSeq) || atSeq < 0) return json(400, { error: "atSeq must be a non-negative integer" })
        try {
          await found.app.truncate(atSeq)
          // Broadcast a settle frame so attached clients fold the log again
          // (Session.Truncated is a durable event, but the prompt-stream live
          // feed only carries LoopEvents — a stale transcript must not linger).
          const settle: BusEvent = { type: "done", step: 0, needsContinuation: false, finish: "stop" }
          for (const l of globalListeners) {
            try {
              l({ sessionId: parts[2]!, event: settle })
            } catch {
              // isolated
            }
          }
          return json(200, { truncated: true, atSeq })
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : String(e) })
        }
      }

      // GET/POST /v1/session/:id/policy — read or change this session's
      // permission level (strict | readonly | trusted). The change is durable
      // (Session.PolicyChanged) and effective from the next prompt.
      if (parts.length === 4 && parts[1] === "session" && parts[3] === "policy" && (method === "GET" || method === "POST")) {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "policy on a remote-owned session is not proxied yet" })
        if (method === "GET") return json(200, { policy: found.app.policy() })
        const parsed = await readJsonOr400<{ policy?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const policy = parsed.policy
        if (policy !== "strict" && policy !== "readonly" && policy !== "trusted") return json(400, { error: "policy must be strict | readonly | trusted" })
        await found.app.setPolicy(policy)
        return json(200, { policy })
      }

      // POST /v1/session/:id/compact — manual fold (codex Op::Compact): one
      // compaction now with the loop's own summarizer; refused while a drain
      // is live (409) rather than racing the turn's compaction.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "compact") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return proxyJson(found.entry, `/v1/session/${parts[2]!}/compact`, { method: "POST" })
        if (found.app.isBusy()) return json(409, { error: "session busy" })
        try {
          return json(200, await found.app.compact())
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : String(e) })
        }
      }

      // GET /v1/fs?path=&workspace= — sandboxed one-level listing.
      if (method === "GET" && parts.length === 2 && parts[1] === "fs") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        const ws = url.searchParams.get("workspace") ?? settings.get().workspace
        const rel = url.searchParams.get("path") ?? "."
        const rootAbs = resolve(ws)
        const targetAbs = resolve(ws, rel)
        if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) return json(403, { error: "path escapes the workspace" })
        // Symlink re-check (same invariant as /v1/file): a workspace-internal
        // symlink pointing OUT must not yield an outside-workspace listing.
        let canon = targetAbs
        try {
          canon = await realpath(targetAbs)
        } catch {
          return json(200, { path: rel, entries: [] })
        }
        if (canon !== rootAbs && !canon.startsWith(rootAbs + sep)) return json(403, { error: "path escapes the workspace" })
        try {
          const dir = await readdir(canon, { withFileTypes: true })
          const entries = []
          for (const d of dir) {
            if (d.name.startsWith(".") || d.name === "node_modules") continue
            entries.push({ name: d.name, dir: d.isDirectory() })
          }
          return json(200, { path: rel, entries: entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)) })
        } catch {
          return json(200, { path: rel, entries: [] })
        }
      }

      // GET /v1/file?workspace=&path= — sandboxed READ-ONLY file content.
      // Text files (no NUL byte in the first 8KB) return utf8 inline; anything
      // else returns base64. Reads are capped at 2MB — an oversized file
      // returns its first 2MB with truncated:true so a preview pane never
      // needs a second response shape. Mirrors the /v1/fs sandbox check.
      if (method === "GET" && parts.length === 2 && parts[1] === "file") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        const ws = url.searchParams.get("workspace") ?? settings.get().workspace
        const rel = url.searchParams.get("path") ?? ""
        if (!rel) return json(400, { error: "path is required" })
        const rootAbs = resolve(ws)
        const targetAbs = resolve(ws, rel)
        if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) return json(403, { error: "path escapes the workspace" })
        // Symlink re-check (docs §3 invariant): resolve() never canonicalizes
        // links, so a workspace-internal symlink pointing OUT would read
        // arbitrary files. Canonicalize and re-test before touching content.
        let targetAbs2 = targetAbs
        try {
          targetAbs2 = await realpath(targetAbs)
        } catch {
          return json(404, { error: "file not found" })
        }
        if (targetAbs2 !== rootAbs && !targetAbs2.startsWith(rootAbs + sep)) return json(403, { error: "path escapes the workspace" })
        const file = Bun.file(targetAbs2)
        let stat: { size: number; isDirectory(): boolean }
        try {
          stat = await file.stat()
        } catch {
          return json(404, { error: "file not found" })
        }
        if (stat.isDirectory()) return json(403, { error: "path is a directory" })
        const MAX = 2_000_000
        const bytes = new Uint8Array(await file.slice(0, MAX).arrayBuffer())
        const truncated = stat.size > MAX
        const sniffEnd = Math.min(bytes.length, 8000)
        let binary = false
        for (let i = 0; i < sniffEnd; i++) {
          if (bytes[i] === 0) {
            binary = true
            break
          }
        }
        const content = binary ? Buffer.from(bytes).toString("base64") : new TextDecoder().decode(bytes)
        return json(200, { path: rel, size: stat.size, encoding: binary ? "base64" : "utf8", content, ...(truncated ? { truncated: true } : {}) })
      }

      // GET /v1/files/find?workspace=&q= — recursive filename search for the
      // client's @-mention picker (opencode fs.find shape, dumb+fast v1):
      // case-insensitive substring on the relative path, dirs skipped in
      // results, symlinks never followed, ≤8 deep, ≤5000 entries walked,
      // ≤50 results sorted shallow-first.
      if (method === "GET" && parts.length === 3 && parts[1] === "files" && parts[2] === "find") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        const ws = url.searchParams.get("workspace") ?? settings.get().workspace
        const q = (url.searchParams.get("q") ?? "").trim().toLowerCase()
        if (!q) return json(200, { results: [] })
        const rootAbs = resolve(ws)
        let canon = rootAbs
        try {
          canon = await realpath(rootAbs)
        } catch {
          return json(200, { results: [] })
        }
        const results: string[] = []
        let visited = 0
        const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
          if (results.length >= 50 || depth > 8 || visited > 5000) return
          let entries
          try {
            entries = await readdir(dir, { withFileTypes: true })
          } catch {
            return
          }
          for (const d of entries) {
            if (results.length >= 50 || visited > 5000) return
            visited++
            if (d.name.startsWith(".") || d.name === "node_modules") continue
            if (d.isSymbolicLink()) continue
            const p = rel ? rel + "/" + d.name : d.name
            if (d.isDirectory()) await walk(join(canon, p), p, depth + 1)
            else if (p.toLowerCase().includes(q)) results.push(p)
          }
        }
        await walk(canon, "", 0)
        results.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
        return json(200, { results: results.slice(0, 50) })
      }

      // GET /v1/mcp/resources — the MCP resource surface (server name →
      // resources + per-server error when the server ships tools only).
      if (method === "GET" && parts.length === 3 && parts[1] === "mcp" && parts[2] === "resources") {
        if (!mcpResources) return json(404, { error: "no mcp servers configured" })
        return json(200, { byServer: mcpResources.byServer })
      }

      // GET /v1/mcp/resource?server=&uri= — one resource's text content
      // (resources/read through the server's live transport).
      if (method === "GET" && parts.length === 3 && parts[1] === "mcp" && parts[2] === "resource") {
        if (!mcpResources) return json(404, { error: "no mcp servers configured" })
        const server = url.searchParams.get("server") ?? ""
        const uri = url.searchParams.get("uri") ?? ""
        if (!server || !uri) return json(400, { error: "server and uri are required" })
        try {
          const content = await mcpResources.readResource(server, uri)
          return json(200, { server, uri, ...content })
        } catch (e) {
          return json(502, { error: `resource read failed: ${e instanceof Error ? e.message : String(e)}` })
        }
      }

      // GET /v1/skills — the pluginsDir skills catalog (level 1 + body on demand).
      if (method === "GET" && parts.length === 2 && parts[1] === "skills") {
        if (!pluginsDir) return json(404, { error: "no pluginsDir configured" })
        const name = url.searchParams.get("name")
        const skills = await discoverSkills(pluginsDir)
        if (name) {
          const hit = skills.find((sk) => sk.name === name)
          return hit ? json(200, hit) : json(404, { error: "unknown skill" })
        }
        return json(200, { skills: skills.map((sk) => ({ name: sk.name, description: sk.description, path: sk.path })) })
      }

      // DELETE /v1/skills?name= — remove an imported skill's directory
      // (directory-as-registration: deletion is removal from the same dir).
      if (method === "DELETE" && parts.length === 2 && parts[1] === "skills") {
        if (!pluginsDir) return json(404, { error: "no pluginsDir configured" })
        const name = (url.searchParams.get("name") ?? "").trim()
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return json(400, { error: "skill name must be a slug (letters, digits, -, _)" })
        const dir = join(pluginsDir, "skills", name)
        try {
          await rm(dir, { recursive: true, force: true })
        } catch (e) {
          return json(500, { error: `skill delete failed: ${e instanceof Error ? e.message : String(e)}` })
        }
        return json(200, { removed: true, name })
      }

      // POST /v1/skills — import a skill through the directory seam:
      // {name, description?, body} → pluginsDir/skills/<name>/SKILL.md.
      if (method === "POST" && parts.length === 2 && parts[1] === "skills") {
        if (!pluginsDir) return json(404, { error: "no pluginsDir configured" })
        const parsed = await readJsonOr400<{ name?: string; description?: string; body?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const name = (parsed.name ?? "").trim()
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return json(400, { error: "skill name must be a slug (letters, digits, -, _)" })
        const body = (parsed.body ?? "").trim()
        if (!body) return json(400, { error: "body is required" })
        try {
          const dir = join(pluginsDir, "skills", name)
          // YAML-safe description (quoted + escaped; a raw ": " or leading
          // "*" would corrupt the frontmatter the discovery parser reads).
          const desc = parsed.description?.trim().replace(/\n/g, " ")
          const fm = desc ? `---\ndescription: ${JSON.stringify(desc)}\n---\n\n` : ""
          await mkdir(dir, { recursive: true })
          const path = join(dir, "SKILL.md")
          // Atomic write (tmp + rename) — same rule as the config file: a
          // crash mid-write must not leave a truncated SKILL.md on disk.
          const tmp = path + ".tmp"
          await writeFile(tmp, fm + body + "\n", "utf8")
          await rename(tmp, path)
          return json(201, { name, description: desc, path })
        } catch (e) {
          return json(500, { error: `skill write failed: ${e instanceof Error ? e.message : String(e)}` })
        }
      }

      // GET /v1/agents — discovered agent roles (name/model/allowedTools).
      if (method === "GET" && parts.length === 2 && parts[1] === "agents") {
        if (!pluginsDir) return json(404, { error: "no pluginsDir configured" })
        const caps = await discoverPlugin(pluginsDir)
        return json(200, { agents: caps.filter((c) => c.kind === "agent") })
      }

      // GET /v1/commands — discovered slash commands (name/description only).
      if (method === "GET" && parts.length === 2 && parts[1] === "commands") {
        if (!pluginsDir) return json(404, { error: "no pluginsDir configured" })
        const caps = await discoverPlugin(pluginsDir)
        return json(200, { commands: caps.filter((c) => c.kind === "command").map((c) => ({ name: c.name, description: c.description })) })
      }

      // POST /v1/session/:id/command {text} — run a slash line ("/name args")
      // through the session's command seam. Returns the expansion text (the
      // client puts it back into the composer); 404 when not a command.
      if (method === "POST" && parts.length === 4 && parts[1] === "session" && parts[3] === "command") {
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "commands on a remote-owned session are not proxied yet" })
        const parsed = await readJsonOr400<{ text?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.text?.trim()) return json(400, { error: "text is required" })
        const output = await found.app.runCommand(parsed.text)
        if (output === undefined) return json(404, { error: `unknown command: ${parsed.text.trim().split(/\s+/)[0]}` })
        return json(200, { output })
      }

      // POST /v1/session/:id/references/resolve {text} — active toolset for the
      // "@" mention: parse @agent:name / @skill:name / @mcp:server/uri and inject
      // the referenced CONTENT into the prompt so the model sees real material
      // (agent body / skill body / mcp resource text), not a bare "@name" token.
      // Unresolvable refs (unknown name, no pluginsDir) stay as literal text.
      if (method === "POST" && parts.length === 5 && parts[1] === "session" && parts[3] === "references" && parts[4] === "resolve") {
        if (parts[2] !== undefined) { /* session-scoped; found below */ }
        const found = await findSession(parts[2]!)
        if (found.kind === "missing") return json(404, { error: found.error })
        if (found.kind === "remote") return json(501, { error: "references on a remote-owned session are not proxied yet" })
        const parsed = await readJsonOr400<{ text?: string }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        if (!parsed.text?.trim()) return json(400, { error: "text is required" })
        let expanded = parsed.text
        const resolved: Array<{ kind: "agent" | "skill" | "mcp"; label: string; content: string }> = []
        const caps = pluginsDir ? await discoverPlugin(pluginsDir) : []
        const agents = caps.filter((c) => c.kind === "agent")
        const skills = pluginsDir ? await discoverSkills(pluginsDir) : []
        // Resolve each reference to real content, then inline it. Each ref either
        // resolves to injected material (declared) or stays a literal token.
        expanded = await expandReferences(expanded, { agents, skills, mcpResources: mcpResources ?? null }, resolved)
        return json(200, { expanded, resolved })
      }

      // GET /v1/settings — effective settings, secrets redacted.
      if (method === "GET" && parts.length === 2 && parts[1] === "settings") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        return json(200, redactSettings(settings.get()))
      }

      // GET /v1/token — the LAN token is only revealed to LOOPBACK callers:
      // the desktop shell shows it so the user can type it on the phone; a
      // remote device must already know it (it would not need to fetch it).
      if (method === "GET" && parts.length === 2 && parts[1] === "token") {
        if (!fromLoopback) return json(404, { error: "token is only revealed to loopback callers" })
        return json(200, { token: settings?.get().token ?? null })
      }

      // GET /v1/network — LAN IP the phone should reach (loopback callers
      // only: the local shell builds the phone URL from it; a remote device
      // already knows its own target). Windows picks the first non-loopback
      // IPv4; multi-homed machines may need `host` in config.
      if (method === "GET" && parts.length === 2 && parts[1] === "network") {
        const lan = firstLanIpv4()
        return json(200, { lanIp: lan ?? null, port: settings?.get().port ?? 3927 })
      }

      // PUT /v1/settings — merge a patch into the agent-home config file.
      if (method === "PUT" && parts.length === 2 && parts[1] === "settings") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        const parsed = await readJsonOr400<AgentHomeConfig>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const next = await settings.write(parsed)
        return json(200, redactSettings(next))
      }

      // GET /v1/models — the configured provider's available model ids.
      if (method === "GET" && parts.length === 2 && parts[1] === "models") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        const provider: AdapterConfig = settings.get().provider
        const models = await listModels(provider, config.modelsFetch ?? globalThis.fetch.bind(globalThis))
        return json(200, { models })
      }

      // GET /v1/approvals — pending interactive approvals (the client polls).
      if (method === "GET" && parts.length === 2 && parts[1] === "approvals") {
        if (!approvals) return json(404, { error: "no approval hub configured" })
        return json(200, { approvals: approvals.pending() })
      }

      // POST /v1/approvals/:id {allow, reply?, scope?} — settle one pending
      // approval; a question-kind request carries the operator's answer in
      // `reply`; `scope: "workspace"` remembers the approval across sessions
      // of the same project (session is the default).
      if (method === "POST" && parts.length === 3 && parts[1] === "approvals") {
        if (!approvals) return json(404, { error: "no approval hub configured" })
        const parsed = await readJsonOr400<{ allow?: boolean; reply?: string; scope?: "session" | "workspace" }>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        const scope = parsed.scope === "workspace" ? "workspace" : undefined
        const settled = approvals.resolve(parts[2]!, parsed.allow === true, typeof parsed.reply === "string" ? parsed.reply : undefined, scope)
        return json(settled ? 200 : 404, settled ? { settled: true } : { error: "unknown or already-settled approval id" })
      }

      // GET /v1/usage?days=N — per-day token totals (heatmap data).
      if (method === "GET" && parts.length === 2 && parts[1] === "usage") {
        if (!settings) return json(404, { error: "no settings controller configured" })
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30)))
        try {
          return json(200, await aggregateUsage(join(settings.get().dataDir, "events.db"), days))
        } catch (e) {
          // No events db yet (fresh install) — an empty summary, not an error.
          return json(200, { days: [], totals: { inputTokens: 0, outputTokens: 0, steps: 0 }, sessions: 0, note: e instanceof Error ? e.message : String(e) })
        }
      }

      // GET /v1/schedules — all scheduled prompts.
      if (method === "GET" && parts.length === 2 && parts[1] === "schedules") {
        if (!schedules) return json(404, { error: "no scheduler configured" })
        return json(200, { schedules: await schedules.list() })
      }

      // POST /v1/schedules — create a scheduled prompt.
      if (method === "POST" && parts.length === 2 && parts[1] === "schedules") {
        if (!schedules) return json(404, { error: "no scheduler configured" })
        const parsed = await readJsonOr400<ScheduleInput>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        try {
          const created: Schedule = await schedules.add(parsed)
          return json(201, created)
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : String(e) })
        }
      }

      // PATCH /v1/schedules/:id — update (enable/disable, change prompt/cadence).
      if (method === "PATCH" && parts.length === 3 && parts[1] === "schedules") {
        if (!schedules) return json(404, { error: "no scheduler configured" })
        const parsed = await readJsonOr400<Partial<ScheduleInput>>(req)
        if (parsed instanceof Response) return parsed
        if ("error" in parsed) return json(400, parsed)
        try {
          const updated = await schedules.update(parts[2]!, parsed)
          return updated ? json(200, updated) : json(404, { error: "unknown schedule id" })
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : String(e) })
        }
      }

      // DELETE /v1/schedules/:id
      if (method === "DELETE" && parts.length === 3 && parts[1] === "schedules") {
        if (!schedules) return json(404, { error: "no scheduler configured" })
        const removed = await schedules.remove(parts[2]!)
        return json(removed ? 200 : 404, removed ? { removed: true } : { error: "unknown schedule id" })
      }

      // POST /v1/schedules/:id/run — fire one schedule now.
      if (method === "POST" && parts.length === 4 && parts[1] === "schedules" && parts[3] === "run") {
        if (!schedules) return json(404, { error: "no scheduler configured" })
        const ok = await schedules.runNow(parts[2]!)
        return json(ok ? 200 : 404, ok ? { triggered: true } : { error: "unknown schedule id" })
      }

      return json(404, { error: "not found" })
    },
  })

  // Cross-process liveness: refresh this endpoint's heartbeat so siblings do
  // not sweep live sessions during long-running turns, and sweep rows whose
  // owner stopped heartbeating (crash / kill -9 — 30s = three missed ticks
  // plus event-loop stall margin). Unref'd — never holds the process open.
  const heartbeatTimer = directory ? setInterval(() => {
    try {
      directory.heartbeat(selfUrl())
      directory.sweep(30_000)
    } catch {
      // A transient lock/busy on the shared file is non-fatal — the next tick
      // refreshes; a persistently failed heartbeat surfaces via sweep.
    }
  }, 10_000) : undefined

  // Scheduled prompts (定时任务): when a scheduler is wired, the server owns a
  // 30s tick; each DUE schedule is fired through the scheduler's own `fire`
  // callback, which the host delegates to handle.admitPrompt (below).
  let scheduleTimer: ReturnType<typeof setInterval> | undefined
  if (schedules) {
    scheduleTimer = setInterval(() => {
      void schedules.tick().catch(() => {
        // A transient tick failure (lock, fs) is non-fatal — the next tick retries.
      })
    }, 30_000)
  }

  const admitPrompt = async (sessionId: string, prompt: string): Promise<void> => {
    const resolved = await resolveApp({ sessionId })
    const app = resolved?.app
    if (!app) throw new Error(`cannot attach session "${sessionId}" (no sessionConfig)`)
    void app.prompt(prompt, "user").catch((e) => {
      // The scheduler records admission, not settlement — a dead turn must be
      // LOUD in the log so a silent schedule failure is diagnosable.
      console.error(`[admitPrompt] session "${sessionId}" prompt failed:`, e instanceof Error ? e.message : e)
    })
  }

  const handle: ServerHandle = {
    baseUrl: `http://${host}:${server.port}`,
    appFor: (id) => apps.get(id),
    admitPrompt,
    stop: async () => {
      // Interrupt any in-flight prompt BEFORE closing the event store, then
      // wait (bounded) for them to settle — a late settle path would append
      // into a closed store.
      for (const app of apps.values()) app.interrupt()
      const deadline = Date.now() + 2000
      while (inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
      server.stop()
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      if (scheduleTimer) clearInterval(scheduleTimer)
      // Release cross-process ownership for everything this process created.
      // Contention on the shared file must not skip the store shutdown below.
      if (directory) {
        for (const id of owned) {
          try {
            directory.unregister(id)
          } catch {
            // Heartbeat staleness sweep covers an un-unregistered row.
          }
        }
      }
      for (const app of apps.values()) {
        // SqliteEventStore has close(); the EventStore interface doesn't.
        (app.events as { close?: () => void }).close?.()
      }
    },
  }
  return handle
}
