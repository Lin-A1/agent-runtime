import { MemoryEventStore, MemorySessionInput, Session, SqliteEventStore, SessionRegistry, runSession, stableSessionId, createAttachmentStore, base64ToBytes, type Agent, type TurnRuntime, type Tool, type EventStore, type LoopEvent, type SessionRow, type RegistryQuery, type AuditEventRow, type Initiator, type RunOptions, type PromptImage, type AttachmentStore } from "@newhorse/core"
import { join, dirname } from "node:path"
import type { AttachmentRef } from "@newhorse/schema"
import { mkdir } from "node:fs/promises"
import { createAdapterRegistry, makeLlmClient, type AdapterConfig, type AdapterRegistry, type Fetcher } from "@newhorse/llm"
import { PluginRegistry, discoverPlugin } from "@newhorse/plugin"
import type { MemoryStore } from "@newhorse/memory"
import { runMemoryExtraction } from "@newhorse/memory"
import { createEmbeddingProvider, type EmbeddingConfig } from "@newhorse/memory"
import { createDefaultMemoryPipeline } from "./memory-pipeline"
import { createButlerTools } from "./butler"
import { createSessionHub } from "./hub"
import { TerminalSession, createSharedTerminalTools } from "./terminal"
import { driveChildSession, readChildText } from "./session-manager"
import { resolveAgent, type AgentDefinition } from "./agent-resolver"
import { createDagRunner, type DagRunner } from "./dag-api"
import { currentTodos, type TodoItem, type DAGSpec, compactSession, compactionTailChars, projectCompacted } from "@newhorse/core"
import { currentGoal, type GoalState } from "@newhorse/core"
import { createBuiltinTools, createExecPolicy, rulesFilePath } from "./tools"
import { allowAllExecPolicy } from "@newhorse/core"
import { defaultContextProvider, ensureSystemContext, withRoleBody, BUTLER_BODY, type SessionContextProvider } from "./context"
import type { ExecPolicy, ExecRule, ApprovalRequest } from "@newhorse/schema"

/**
 * Runtime assembly. This is the domain wiring shared by every transport
 * (CLI / web / desktop / SDK). It composes the seams into a runnable agent
 * session and exposes how the model-visible view is produced. It holds NO
 * transport concerns — no stdin/stdout, no WebSocket, no UI. A shell imports
 * `createApp`, drives `prompt`, and renders `events`/the returned history.
 */
export interface AppConfig {
  readonly provider: AdapterConfig
  readonly model: string
  /** Optional executable provider registry. When omitted, the legacy adapter factory is used. */
  readonly adapterRegistry?: AdapterRegistry
  readonly sessionId?: string
  readonly workspace?: string
  /** Optional project grouping id — persisted on Session.Created so the registry
   *  can fold + query sessions per project (issue #3/#4). */
  readonly projectId?: string
  /** A plugin registry whose tools back the agent. Optional. */
  readonly plugins?: PluginRegistry
  /** A plugin directory to discover by convention (tools/agents/commands/
   * hooks). Discovered capabilities are registered into `plugins` (or a fresh
   * registry). M1 consumes only `tool` capabilities into the build; the other
   * kinds register through the same seam so a later milestone can wire them
   * without rework. Optional. */
  readonly pluginsDir?: string
  /** Trust switch for EXECUTABLE plugin code (.ts tool definitions). Off by
   *  default — loading third-party code is a trust decision, not a convention.
   *  JSON tool declarations (schema-only stubs) are unaffected. */
  readonly allowPluginCode?: boolean
  /** Direct tool list override (for tests or embedding). Optional. */
  readonly tools?: readonly Tool[]
  /** Data dir to persist the event store across restarts. */
  readonly dataDir?: string
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  readonly fetch?: Fetcher
  /** Enable the butler toolset (list/send/spawn/interrupt) for this session. */
  readonly asButler?: boolean
  /** Per-tool-result output cap in serialized chars (codex truncation_policy
   *  semantics; core default 20_000). 0 disables. */
  readonly toolOutputMaxChars?: number
  /** Microcompact projection: tool results older than the last N are
   *  projected as placeholders once the visible history is over the
   *  compaction trigger (core default 12). 0 disables. */
  readonly toolResultKeepRecent?: number
  /** The agent-home config directory (self_status reports it so the model
   *  knows where its own configuration lives). */
  readonly agentHome?: string
  /** Chars-per-token ratio for the compaction trigger (file-layer knob;
   *  core default 2.5). */
  readonly charsPerToken?: number
  /** Opt-in web fetch tool (wave 12): escapes the fs sandbox like bash. */
  readonly enableWeb?: boolean
  /** DAG runner backing the butler's declare_dag tool. Absent = the tool
   *  reports unavailable (the HTTP /v1/dag routes stay the host-side path).
   *  Injected per session so node progress projects into the declaring
   *  session's todo list (todoSessionId) under its workspace. */
  readonly dagRunner?: DagRunner
  /** Expose the shell `bash` tool. Off by default because it is not sandboxed
   * to the workspace (M3.5 §2.2): enabling it authorizes the session to
   * read/write/execute any reachable path with the process user's permissions. */
  readonly enableBash?: boolean
  /** M4 execpolicy: user-declared rules (allow/prompt/forbid). Optional; empty
   * rules + the built-in dangerous floor still apply (fail-closed). */
  readonly execRules?: readonly ExecRule[]
  /** M4 execpolicy: interactive approval gate injected by the transport. When
   * absent, a `prompt` resolves to `forbid` (fail-closed). */
  readonly onApprove?: (req: ApprovalRequest) => Promise<boolean>
  /** ask_user channel (approval hub's question half). Absent = the session is
   *  non-interactive and ask_user answers gracefully instead of hanging. */
  readonly onAsk?: (req: { question: string; options?: readonly string[]; sessionId?: string; promptId?: string; tool?: string; callId?: string }) => Promise<{ allow: boolean; reply?: string }>
  /**
   * Memory seam (Phase 4 reserve): when supplied, the memory tools
   * (memory_search / memory_write) are exposed. Absent = no memory tools.
   * (Session.MemoryStored is reserved in schema but NOT emitted yet — the
   * write path currently archives tool results as ordinary tool messages.)
   */
  readonly memoryStore?: MemoryStore
  /**
   * Post-turn memory extraction (default pipe): when enabled AND a memoryStore
   * is present, the session's latest user/assistant turns are extracted into
   * durable memories after a prompt settles (fail-closed — a broken LLM is a
   * no-op). The pipe uses the app's own LLM client + model. Default OFF (a
   * LLM call per turn is a real cost; the caller must opt in).
   */
  readonly memoryExtract?: {
    readonly enabled?: boolean
    /**
     * Extraction trigger seam (pluggable): decide whether to extract after
     * this settled prompt. Default: every settled prompt. E.g. everyNth or
     * content-based triggers slot here without touching the pipeline.
     */
    readonly shouldExtract?: (result: { readonly step: number; readonly finish: string }, sessionId: string) => boolean
    /** How many recent user/assistant turns to feed the extractor (default 30). */
    readonly recentCount?: number
  }
  /**
   * Semantic memory (switchable): when enabled AND a memoryStore is present,
   * an EmbeddingProvider is attached to the store — writes embed their content
   * (fail-soft, deferred) and searches fuse BM25 + cosine via RRF. Off (or a
   * broken endpoint) = keyword-only FTS, which is always the floor.
   */
  /**
   * Approval policy (permission level):
   *   strict (default) — execpolicy floor + interactive/deny approval gate;
   *   trusted          — full access: the permission floor never blocks;
   *   readonly         — plan mode: only sideEffects:false tools are exposed.
   */
  readonly approvalPolicy?: "strict" | "trusted" | "readonly"
  /** The session model's context window in tokens — scales the auto-compaction
   *  trigger to the model (a small window must fold before it overflows, a
   *  large one must not summarize half-empty). Absent = 80k-char fallback. */
  readonly contextWindowTokens?: number
  /** Output budget per model reply (tokens). The anthropic protocol REQUIRES a
   *  max_tokens value — unset, every reply silently truncates at a 4096 floor.
   *  Set per model by the host (e.g. 8192, 16384, 64000). */
  readonly maxOutputTokens?: number
  readonly memoryVector?: {
    readonly enabled?: boolean
    /** Index behind cosine: auto (sqlite-vec when loadable, else in-memory) | brute | off (legacy scan). */
    readonly mode?: "auto" | "brute" | "off"
    readonly embedding: EmbeddingConfig
  }
  /**
   * Workspace context provider (pluggable seam). Default = AGENTS.md discovery
   * + compose (with the Workdir line). A caller can inject a custom provider to
   * override the ambient context (e.g. a narrower scope for a child session).
   */
  readonly contextProvider?: SessionContextProvider
}

/** A live session event a shell may observe (streamed model output, etc.). */
export type AppEvent = LoopEvent

export interface App {
  readonly sessionId: string
  readonly events: EventStore
  /** Content-addressed attachment store for this session's data dir (absent
   *  when the host runs without a dataDir — the legacy inline path applies). */
  readonly attachments?: AttachmentStore
  /** Whether a prompt turn is currently in flight. Transports use it to guard
   *  concurrent admission from external surfaces (channels): two runSession
   *  loops on one log would double-promote inbox rows and orphan the abort
   *  controller. */
  readonly isBusy: () => boolean
  /** Manual fold (codex Op::Compact): run one compaction now with the same
   *  summarizer/tail params as the automatic path. Refused while a drain is
   *  in flight (a boundary is projection-safe mid-drain, but the fold's own
   *  LLM call would race the turn's compaction). */
  readonly compact: () => Promise<{ boundarySeq: number; summary: string }>

  /** Subscribe to live session events; returns an unsubscribe function. */
  readonly onEvent: (listener: (event: AppEvent) => void) => () => void
  /**
   * Run one prompt through admission → turn → settlement.
   * `principal` marks who authored the prompt (user from a human TTY, else
   * butler/parent); it drives the caller kind for butler tools (M2b).
   */
  readonly prompt: (text: string, principal?: "user" | "butler" | "parent", images?: readonly PromptImage[], opts?: { replace?: boolean; promptId?: string }) => Promise<PromptResult>
  /** Reconstruct the current session projection from the log. */
  readonly resume: () => Promise<Session>
  /** Query the session registry (observational control surface). */
  readonly listSessions: (query?: RegistryQuery) => Promise<SessionRow[]>
  /** Fold butler audit actions into a readable list. */
  readonly audit: (actorSessionId?: string) => Promise<AuditEventRow[]>
  /** Interrupt the running session (single-process cancel). */
  readonly interrupt: () => void
  /** Steer the running drain: admit a prompt that is promoted at the next safe
   * boundary of the in-flight run (no-op if the session is idle). */
  readonly steer: (text: string) => Promise<void>
  /** Run a slash-command line ("/name arg1 arg2") against a plugin command
   *  capability (the seam's consumer). Returns the command's output, or undefined
   *  when the text is not a registered command. */
  readonly runCommand: (text: string) => Promise<unknown | undefined>
  /** In-place rewind (user "回退"): removes every durable event past atSeq so the
   *  session replays as if later turns never happened, and records the boundary
   *  (Session.Truncated). Refuses out-of-range seqs. */
  readonly truncate: (atSeq: number) => Promise<void>
  /** Human-driven exec (workbench terminal): runs ONE command through the
   *  session's OWN bash tool + exec policy + approval gate — the operator gets
   *  a seat at the agent's console, never a bypass around it. */
  readonly exec: (command: string, signal?: AbortSignal) => Promise<unknown>
  /** Shared workbench terminal (human half): write a full command line or raw
   *  keystrokes (e.g. ^C) into the SAME shell the agent's terminal_send/terminal_read
   *  tools drive. */
  readonly terminalWrite: (input: string, mode?: "command" | "raw") => void
  /** Shared workbench terminal: incremental output + who ran what. */
  readonly terminalRead: (since: number) => { cursor: number; text: string; alive: boolean; activity: Array<{ source: "human" | "agent"; text: string; ts: number }> }
  /** Kill the shared terminal shell (session teardown). */
  readonly terminalDispose: () => void
  /** Switch this session's model (Session.ModelSet, durable — survives
   *  re-attach). Takes effect on the NEXT prompt. */
  readonly setModel: (model: string) => Promise<void>
  /** Context composition breakdown (chars per bucket) for the workbench
   *  context panel: system prompt vs conversation vs tool-surface cost. */
  readonly contextBreakdown: () => Promise<{ systemPromptChars: number; messagesChars: number; builtinToolsChars: number; mcpToolsChars: number; otherChars: number }>
  /** Read the session's current todo list (durable fold — restart-safe). */
  readonly todos: () => Promise<TodoItem[]>
  /** Read the session's current goal + budget state (durable fold). */
  readonly goal: () => Promise<GoalState | null>
  /** Read the session's current approval policy. */
  readonly policy: () => "strict" | "trusted" | "readonly"
  /**
   * Change the approval policy (host/operator action). Durably recorded
   * (Session.PolicyChanged) and effective from the next prompt.
   */
  readonly setPolicy: (policy: "strict" | "trusted" | "readonly", by?: "host" | "model") => Promise<void>
}

/** Per-prompt image budget gates (deterministic; docs §5):
 *  - one image ≤ 20MiB source bytes — over → explicit admission error;
 *  - ≤ 5 images per prompt — extras are evicted oldest-position first;
 *  - ≤ 25MiB total per prompt — evicted from the OLDEST position until it
 *    fits, each eviction noted in the prompt text (the model sees what it
 *    did not get). Same input always evicts the same images. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGES_PER_PROMPT = 5
const MAX_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024

async function preparePromptImages(
  text: string,
  images: readonly PromptImage[],
  store: AttachmentStore,
): Promise<{ prompt: string; attachments: readonly AttachmentRef[] }> {
  const stored: Array<{ ref: AttachmentRef; omit?: string }> = []
  for (const img of images) {
    const bytes = base64ToBytes(img.data)
    if (!bytes) throw new Error(`invalid image payload for ${img.mime} (not base64)`)
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image too large: ${img.mime} is ${bytes.length} bytes (max ${MAX_IMAGE_BYTES})`)
    stored.push({ ref: { ...(await store.put(bytes, img.mime)), bytes: bytes.length } })
  }
  const omitted: string[] = []
  while (stored.length > MAX_IMAGES_PER_PROMPT) {
    const dropped = stored.shift()!
    omitted.push(dropped.ref.sha256.slice(0, 8))
  }
  let total = stored.reduce((sum, s) => sum + s.ref.bytes, 0)
  while (total > MAX_TOTAL_IMAGE_BYTES && stored.length > 0) {
    const dropped = stored.shift()!
    total -= dropped.ref.bytes
    omitted.push(dropped.ref.sha256.slice(0, 8))
  }
  const prompt = stored.length < (images.length ? images.length : 0) && omitted.length > 0
    ? `${text}\n[images omitted (over budget): ${omitted.join(", ")}]`
    : text
  return { prompt, attachments: stored.map((s) => s.ref) }
}

/** Structured outcome of a prompt run (a shell renders this, not a string). */
export interface PromptResult {
  readonly step: number
  readonly needsContinuation: boolean
  readonly finish: "tool" | "stop" | "length" | "content-filter" | "interrupted" | "error"
}

/**
 * Assemble the plugin registry's hook capabilities into the loop's hook seam.
 * A hook that BLOCKS returns { decision: "block" } (stop can force another
 * step; pre-tool-use can deny a call). Errors from a hook are isolated: a
 * broken hook must never corrupt the settlement path — it behaves as "allow".
 */
function makeHookRunner(pluginRegistry?: PluginRegistry): RunOptions["runHooks"] {
  if (!pluginRegistry) return undefined
  const hooks = pluginRegistry.list("hook")
  if (hooks.length === 0) return undefined
  return async (event, input) => {
    const matching = hooks.filter((h) => h.event === event)
    if (matching.length === 0) return { decision: "allow" }
    for (const h of matching) {
      try {
        const result = await h.run(input)
        // A hook returning a truthy "block"-ish result decides the verdict.
        if (result && typeof result === "object" && (result as { decision?: string }).decision === "block") {
          return { decision: "block", reason: (result as { reason?: string }).reason }
        }
      } catch {
        // Fail-open to allow: a throwing hook is still observable, but must
        // not deny the turn.
      }
    }
    return { decision: "allow" }
  }
}

export async function createApp(config: AppConfig): Promise<App> {
  if (config.sessionId !== undefined && config.sessionId.trim() === "") {
    throw new Error("sessionId must be a non-empty string")
  }
  const events = await createStore(config.dataDir)
  const inbox = new MemorySessionInput(events)
  await inbox.hydrate()

  // Content-addressed attachment store: only when the host provides a dataDir
  // (an ephemeral/no-disk embedding keeps the legacy inline-image path).
  const attachmentStore: AttachmentStore | undefined = config.dataDir ? createAttachmentStore(join(config.dataDir, "attachments", "v1")) : undefined
  const adapterRegistry = config.adapterRegistry ?? createAdapterRegistry()
  const llm = config.adapterRegistry
    ? adapterRegistry.createClient(config.provider, config.fetch)
    : makeLlmClient(config.provider, config.fetch)
  const runtime: TurnRuntime = { events, inbox, llm, ...(attachmentStore ? { attachments: attachmentStore } : {}) }

  const sessionId = config.sessionId ?? stableSessionId(config.workspace ?? process.cwd())
  const existing = await events.read(sessionId)
  // The log is authoritative for the fixed role and the permission level when
  // a session already exists: re-attaching a butler session (attach-after-fork,
  // lazy re-attach after restart) must bring its coordinator toolset back, and
  // a logged Session.PolicyChanged must survive restarts — silently reverting a
  // readonly session to strict would WIDEN its authority.
  const loggedCreated = existing.find((e) => e.type === "Session.Created")
  const asButler = config.asButler === true || (loggedCreated?.data as { role?: string } | undefined)?.role === "butler"
  const loggedPolicy = [...existing].reverse().find((e) => e.type === "Session.PolicyChanged")?.data as { to?: string } | undefined
  const restoredPolicy = loggedPolicy?.to === "strict" || loggedPolicy?.to === "readonly" || loggedPolicy?.to === "trusted" ? loggedPolicy.to : undefined
  // Per-session model switch (Session.ModelSet): the log is authoritative — a
  // user's model choice must survive re-attach/restart, like the policy above.
  const loggedModel = [...existing].reverse().find((e) => e.type === "Session.ModelSet")?.data as { model?: string } | undefined
  let activeModel = loggedModel?.model?.trim() ? loggedModel.model : config.model
  if (existing.length === 0) {
    // `role` marks the fixed session role (registry fold → client badge); only
    // emitted for butler so ordinary sessions keep the lean Created payload.
    await events.append(sessionId, "Session.Created", { id: sessionId, location: config.workspace ?? process.cwd(), createdAt: Date.now(), ...(config.projectId ? { projectId: config.projectId } : {}), ...(asButler ? { role: "butler" } : {}) })
  }

  const registry = new SessionRegistry(events)
  // Priority (M3.5 §2.3): semantics are discriminated on `!== undefined`, not
  // truthiness. `config.tools === undefined` -> assemble the default baseline
  // (plugin + builtin, plugin wins name collisions). A provided array is an
  // EXPLICIT override: non-empty -> explicit > plugin > builtin (additive, first
  // occurrence wins a name collision); an explicit empty array is the deliberate
  // signifier "no tools" (the toolset is override-to-zero, not "keep read/write/
  // edit"). Tools are pluggable, so an override can be re-plugged later.
  const workspace = config.workspace ?? process.cwd()
  const contextProvider: SessionContextProvider = config.contextProvider ?? defaultContextProvider
  // Semantic memory (switchable): attach the embedder BEFORE the toolset so
  // memory writes embed from the first turn; off or a broken endpoint degrades
  // to keyword-only FTS (the always-present floor). Backfill runs in the
  // background (budgeted; idempotent).
  if (config.memoryStore && config.memoryVector?.enabled && config.memoryVector.embedding) {
    const embedder = createEmbeddingProvider(config.memoryVector.embedding)
    // A custom MemoryStore without attachEmbedder cannot do semantic search —
    // warn once instead of crashing createApp on a non-null assertion.
    if (!config.memoryStore.attachEmbedder) {
      console.error("\u001b[33m[memory] memoryVector.enabled but the store does not support attachEmbedder — semantic search off\u001b[0m")
    } else {
      // One-time stderr notice when embedding fails (silent degradation is the
      // failure mode that makes a user believe semantic search is on).
      let warnedEmbedFail = false
      const watched: typeof embedder = {
        dimensions: embedder.dimensions,
        embed: async (text, purpose) => {
          const v = await embedder.embed(text, purpose)
          if (!v && !warnedEmbedFail) {
            warnedEmbedFail = true
            console.error("\u001b[33m[memory] embedding failed — semantic search degraded to keyword-only (check the embedding endpoint/key)\u001b[0m")
          }
          return v
        },
      }
      // Tag = the embedding model so rows from different models never mix.
      const { backfill } = config.memoryStore.attachEmbedder(watched, config.memoryVector.embedding.model, { vectorMode: config.memoryVector.mode ?? "auto" })
      void backfill().catch(() => {})
    }
  }
  // Shared workbench terminal (human-machine co-operation seam): ONE persistent
  // shell per session that the human (web terminal) and the agent
  // (terminal_send/terminal_read tools) drive together. Available to EVERY
  // session — never a butler privilege. The agent's commands ride the same
  // exec-policy floor as bash.
  const sharedTerminal = new TerminalSession(workspace)
  // skillsDir = the plugin dir (its `skills/` sub-tree is discovered lazily by
  // the skill tool). The tool is only exposed when a pluginsDir is configured.
  const builtin = createBuiltinTools({
    workspace,
    enableBash: config.enableBash ?? false,
    enableWeb: config.enableWeb ?? false,
    memoryStore: config.memoryStore,
    skillsDir: config.pluginsDir,
    events,
    // Self-awareness (wave 9): the model can answer what/where/how-much. The
    // closures read live state (policy, final tool surface) at call time.
    self: {
      sessionId,
      workspace,
      role: asButler ? "newhorse 常驻会话" : "代理",
      model: config.model,
      providerKind: config.provider.kind,
      approvalPolicy: () => currentPolicy,
      toolCount: () => liveSurface.length,
      events,
      contextWindowTokens: config.contextWindowTokens,
      charsPerToken: config.charsPerToken,
      toolResultKeepRecent: config.toolResultKeepRecent,
      ...(config.dataDir ? { dataDir: config.dataDir } : {}),
      ...(config.agentHome ? { agentHome: config.agentHome } : {}),
    },
  })
  // Discover a plugin directory (directory-as-registration-surface) and register
  // its capabilities into a PluginRegistry, so a pluginsDir yields tools (and
  // agents/commands/hooks) by convention rather than requiring the caller to
  // assemble a registry by hand.
  let pluginRegistry = config.plugins
  if (config.pluginsDir) {
    pluginRegistry ??= new PluginRegistry()
    const caps = await discoverPlugin(config.pluginsDir, { trustCode: config.allowPluginCode ?? false })
    if (caps.length > 0) pluginRegistry.registerDiscovered(caps)
  }
  const pluginTools = pluginRegistry?.list("tool").map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: t.execute })) ?? []
  const explicitTools = config.tools ?? []
  // An explicitly-provided empty array is the override-to-zero signifier.
  const tools: Tool[] = config.tools?.length === 0
    ? []
    : [...explicitTools, ...pluginTools, ...builtin]

  if (tools.length > 0) tools.push(...createSharedTerminalTools(sharedTerminal))

  // Butler toolset (M2b): a signed set of privileged tools whose execute reads
  // ctx.caller + ctx.registry to authorize and audit each action.
  const appendAudit = async (entry: { actorKind: "user" | "butler" | "parent"; actorId: string; op: string; targetSessionId?: string; outcome: "allowed" | "denied"; reason?: string }): Promise<void> => {
    await events.append(`audit:${sessionId}`, "Session.ButlerAction", {
      sessionId,
      actorKind: entry.actorKind,
      actorId: entry.actorId,
      op: entry.op,
      targetSessionId: entry.targetSessionId,
      outcome: entry.outcome,
      reason: entry.reason,
      ts: Date.now(),
    })
  }
  if (asButler) tools.push(...createButlerTools({ registry, appendAudit }))

  // First occurrence wins so precedence (explicit > plugin > builtin) is
  // preserved: a later duplicate with the same name never shadows a higher-
  // priority tool. `new Map` alone would make the LAST entry win, inverting
  // the order we built `tools` in.
  const toolMap = new Map()
  for (const t of tools) if (!toolMap.has(t.name)) toolMap.set(t.name, t)
  // The model must not see duplicate function names (conflicting schemas across
  // the explicit/plugin/builtin copies). Resolve the agent's tool list from the
  // deduped map so execution precedence and the protocol surface agree.
  const agentTools = [...toolMap.values()]
  // Approval policy (permission level): readonly filters the model's tool
  // surface to sideEffects:false tools (declarative — no name blacklists);
  // trusted leaves the surface whole and short-circuits the floor below.
  // Approval policy is DYNAMIC: the host may set it (app.setPolicy) and the
  // model may request a change (request_mode tool) — so the tool surface and
  // the floor are computed per-prompt from currentPolicy, never cached.
  let currentPolicy: "strict" | "trusted" | "readonly" = restoredPolicy ?? config.approvalPolicy ?? "strict"
  const applyPolicy = (tools: typeof agentTools, policy: "strict" | "trusted" | "readonly") =>
    policy === "readonly" ? tools.filter((t) => t.sideEffects === false) : tools

  // The LIVE tool surface of the running prompt (mutable in place): when the
  // policy changes mid-drain (request_mode approved), the same array is
  // refilled so the next turn's request sees the widened surface — agent.tools
  // is captured once per drain by the loop, so in-place is the only way.
  let liveSurface: Tool[] = []
  // request_mode: the model's ONLY channel out of readonly/plan mode. It goes
  // through the SAME onApprove gate the transport installed — approval is the
  // host's decision, and only then does the policy actually change.
    const requestModeTool: Tool = {
    name: "request_mode",
    sideEffects: false, // a request, not an execution — the gate decides
    description: "Request a change of the session approval policy (only meaningful in readonly/plan mode). Args: { target: \"strict\" | \"trusted\", reason } — the host approves or denies; on approval the policy changes for subsequent turns.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["strict", "trusted"] },
        reason: { type: "string", description: "Why the plan is complete and execution mode is needed." },
      },
      required: ["target", "reason"],
    },
    execute: async (input: unknown, ctx?: import("@newhorse/core").ToolCtx) => {
      const { target, reason } = (input ?? {}) as { target?: string; reason?: string }
      if (target !== "strict" && target !== "trusted") return { error: 'target must be "strict" or "trusted"' }
      if (!reason) return { error: "reason is required" }
      const approved = config.onApprove
        ? await config.onApprove({
            id: crypto.randomUUID(),
            kind: "mode",
            target,
            decision: "prompt",
            reason,
            ...(ctx?.sessionId ? { sessionId: ctx.sessionId } : {}),
            ...(ctx?.promptId ? { promptId: ctx.promptId } : {}),
            ...(ctx?.toolName ? { tool: ctx.toolName } : {}),
            ...(ctx?.toolCallId ? { callId: ctx.toolCallId } : {}),
          })
        : false // no gate installed → the host was never asked → deny
      if (!approved) return { requested: target, granted: false, reason: "host denied the mode change" }
      // Inline the policy change (by: "model-approved"): currentPolicy is a
      // closure variable and the durable event records WHO changed it. The
      // live surface is refilled IN PLACE so the next turn's request sees the
      // widened tool set.
      const from = currentPolicy
      currentPolicy = target
      liveSurface.length = 0
      liveSurface.push(...agentTools)
      await events.append(sessionId, "Session.PolicyChanged", { sessionId, from, to: target, by: "model-approved", ts: Date.now() })
      return { requested: target, granted: true, policy: target }
    },
  }
  // `model` is read live from activeModel at each prompt (promptAgent spreads
  // it per turn) so a Session.ModelSet switch takes effect on the NEXT turn.
  const agent: Agent = { id: "primary", model: config.model, tools: agentTools }

  // Agent definitions (Phase 4): pulled from the plugin seam (list("agent")) —
  // name -> definition, consumed by DAG nodes and butler spawn via resolveAgent.
  const agentDefinitions: Record<string, AgentDefinition> = {}
  for (const cap of pluginRegistry?.list("agent") ?? []) {
    agentDefinitions[cap.name] = { name: cap.name, description: cap.description, body: cap.body, allowedTools: cap.allowedTools, role: cap.role, model: cap.model }
  }

  // Butler hub (M2b) with a LIVE child driver (Phase 3). spawn now actually
  // RUNS the child (Created → system context → admit → runSession) and, on
  // settle, promotes the child's final text into the PARENT's inbox as a
  // synthetic result so the parent's next turn sees it. Without the driver
  // (non-butler) the hub is undefined.
  // DAG runner backing the butler's declare_dag: bound per declare to THIS
  // session's todo list (todoSessionId) under its workspace. A butler session
  // MUST have a runner, and it MUST be over the SAME event store as the session
  // — otherwise DAG children land in a separate aggregate scope and the butler's
  // list_sessions / followup_task can never see them. A host may inject one, but
  // when none is injected we build a default over this app's own `events`.
  const dagRunner: DagRunner | undefined =
    config.dagRunner ??
    (asButler
      ? createDagRunner({
          events,
          dataDir: config.dataDir ?? config.agentHome ?? process.cwd(),
          getProvider: () => config.provider,
          getDefaultModel: () => config.model,
          getWorkspace: () => workspace,
          enableBash: config.enableBash ?? false,
          memoryStore: config.memoryStore,
          skillsDir: config.pluginsDir,
          // Thread the session's fetch so the node child uses the same (possibly
          // injected/test) transport instead of the global one — otherwise a
          // butler-declared DAG node would silently hit the network in tests.
          ...(config.fetch ? { fetch: config.fetch } : {}),
        })
      : undefined)
  // Shared child-driver body (Phase 3): the ONE code path that accepts a child
  // prompt (spawn or resume) and drives it to a durable Settled boundary while
  // promoting the result into the PARENT's inbox. Factored out of the spawn
  // closure so `resume_agent` can re-drive a settled child through the same
  // machinery instead of faking an `implemented:false`.
  const runChild = async (childId: string, parentId: string, childWorkspace: string, model: string | undefined, prompt: string | undefined, agentName: string | undefined, registerLive: ((abort: () => void, admit: (text: string) => Promise<void>) => () => void) | undefined): Promise<void> => {
    // Role overlay (Phase 4): a named agent from the plugin registry
    // narrows tools + supplies a system body; else bare spawned agent.
    // An UNKNOWN agent name fails loudly (a typo must not silently spawn
    // a full-authority child with no body).
    if (agentName && !agentDefinitions[agentName]) {
      throw new Error(`unknown agent "${agentName}" (not registered in the plugin registry)`)
    }
    const agentDef = agentName ? agentDefinitions[agentName] : undefined
    const resolved = resolveAgent(agentDef, { tools: agentTools, model: activeModel }, model)
    // Tracks whether the durable Settled append already happened — the
    // catch path must not append a second one (queryTask reads the first).
    let settledDurable = false
    try {
      // Subagent lifecycle hooks (claude-code SubagentStart/Stop shape):
      // observational, errors isolated by the hook runner itself.
      void hookRunner?.("subagent-start", { childId, parentId, agent: agentName }).catch(() => {})
      const driven = await driveChildSession({
        runtime,
        inbox,
        events,
        sessionId: childId,
        workspace: childWorkspace,
        agent: { id: resolved.id, model: resolved.model, tools: [...resolved.tools] },
        tools: [...resolved.tools],
        prompt: prompt ?? "You are a spawned agent working for your parent. Complete the task.",
        parentId,
        systemExtra: resolved.body,
        registerLive,
        contextProvider: config.contextProvider,
      })
      // Durable settle boundary (followup_task reads it) + promote the
      // child's text into the parent's inbox as a steer so the parent's
      // next turn can consume the result (result promotion).
      await events.append(childId, "Session.Settled", { sessionId: childId, finish: driven.finish, needsContinuation: false })
      settledDurable = true
      void hookRunner?.("subagent-stop", { childId, parentId, finish: driven.finish }).catch(() => {})
      if (driven.settled) {
        await inbox.admit({ id: crypto.randomUUID(), sessionId: parentId, prompt: `[child ${childId} result]\n${driven.text}`, delivery: "steer", principal: "parent" })
      } else {
        // Interrupted: promote the failure marker so followup_task + the
        // parent see a terminal state, not a forever-"running" zombie.
        await inbox.admit({ id: crypto.randomUUID(), sessionId: parentId, prompt: `[child ${childId} interrupted]\n${driven.text}`, delivery: "steer", principal: "parent" })
      }
    } catch (err) {
      // A rejected driver would otherwise leave the child un-setled
      // (followup_task reports "running" forever) and the parent without
      // any promotion. Surface it as a durable failure on both ends —
      // but never double-append Settled when the success path already did.
      const message = err instanceof Error ? err.message : String(err)
      if (!settledDurable) await events.append(childId, "Session.Settled", { sessionId: childId, finish: "error", needsContinuation: false })
      await inbox.admit({ id: crypto.randomUUID(), sessionId: parentId, prompt: `[child ${childId} failed]\n${message}`, delivery: "steer", principal: "parent" })
    }
  }
  // Resume re-drives an EXISTING child: resolution of its parent/workspace/model
  // comes from its durable log (Session.Created + Session.Spawned), not from new
  // spawn args — so resuming a child created by another path stays correct.
  const resumeChild = async (childId: string, prompt: string, registerLive: ((abort: () => void, admit: (text: string) => Promise<void>) => () => void) | undefined): Promise<void> => {
    const log = await events.read(childId)
    const created = log.find((e) => e.type === "Session.Created")
    const spawned = log.find((e) => e.type === "Session.Spawned")
    const createdData = (created?.data ?? {}) as { location?: string; role?: string }
    const spawnedData = (spawned?.data ?? {}) as { parentId?: string }
    const parentId = spawnedData.parentId ?? "user"
    const childWorkspace = createdData.location ?? workspace ?? process.cwd()
    await runChild(childId, parentId, childWorkspace, undefined, prompt, undefined, registerLive)
  }
  const hub = asButler
    ? createSessionHub(
        events,
        () => ({ interrupt: () => {}, prompt: async () => "" }),
        workspace,
        (childId, parentId, childWorkspace, model, prompt, agentName, registerLive) => runChild(childId, parentId, childWorkspace, model, prompt, agentName, registerLive),
        resumeChild,
      )
    : undefined

  // M4 execpolicy: the tool-layer authorization axis. For a session with no
  // onApprove gate (DAG child / non-interactive SDK), a `prompt` resolves to
  // forbid (fail-closed). The rules engine loads/reboots from dataDir; without a
  // dataDir the policy still applies the built-in danger floor.
  const execAudit = async (entry: { kind: "command" | "path"; action: string; decision: "prompt" | "forbid"; reason?: string; requestId?: string }): Promise<void> => {
    await events.append(`audit:${sessionId}`, "Session.ExecDecision", {
      sessionId,
      kind: entry.kind,
      action: entry.action,
      decision: entry.decision,
      reason: entry.reason,
      requestId: entry.requestId,
      ts: Date.now(),
    })
  }
  // One hook runner at app scope: the prompt drain, the manual surfaces
  // (interrupt / user-prompt-submit) and the hub's subagent lifecycle all
  // share it — a hook registered once is observable everywhere.
  const hookRunner = makeHookRunner(pluginRegistry)
  // Rules persist under the session's data home; the last-resort fallback is
  // the agent home's data dir (NEVER a cwd-relative path — co-located
  // processes would share one rules file).
  const rulesFile = rulesFilePath(config.dataDir ?? join(config.agentHome ?? process.cwd(), "data"), workspace)
  const execPolicy: ExecPolicy = createExecPolicy({
    rulesFile,
    rules: config.execRules,
    // rulesDir must point at the rules file's own directory (the host-owned
    // location), never the workspace — otherwise every absolute workspace path
    // passed to decidePath would trip the banned-rules-path check. With no
    // dataDir the rules file is a shared sibling location (non-embedded use
    // always passes dataDir; the no-dataDir branch is a fallback).
    rulesDir: dirname(rulesFile),
    onApprove: config.onApprove,
    audit: execAudit,
  })

  // ApprovedForSession (wave 8, codex semantics): an interactively approved
  // command is remembered (exact-string match) — the next identical command
  // runs without re-prompting. Discipline: the base decide still runs first,
  // so only a base "prompt" can be upgraded to "allow" — explicit forbids
  // never lift. Scope: "session" (default, keyed by session id) or
  // "workspace" (keyed by session's workspace, shared across sessions of the
  // same project). The memory is process-scoped (gone on restart).
  const sessionApproved = new Map<string, Set<string>>()
  const approvedKey = (scope: "session" | "workspace", sessionId: string, workspace?: string): string =>
    scope === "workspace" ? `ws:${workspace ?? ""}` : `sess:${sessionId}`
  const hasApproved = (target: string, scope: "session" | "workspace"): boolean =>
    sessionApproved.get(approvedKey(scope, sessionId, workspace))?.has(target) ?? false
  const addApproved = (target: string, scope: "session" | "workspace"): void => {
    const key = approvedKey(scope, sessionId, workspace)
    sessionApproved.set(key, new Set([...(sessionApproved.get(key) ?? []), target]))
  }
  const execPolicySession: ExecPolicy = {
    decide: (cmd) => {
      const base = execPolicy.decide(cmd)
      if (base === "prompt" && (hasApproved(cmd, "workspace") || hasApproved(cmd, "session"))) return "allow"
      return base
    },
    decidePath: (path) => execPolicy.decidePath(path),
    approve: async (req) => {
      const ok = (await execPolicy.approve?.(req)) ?? false
      if (ok && req.kind === "command" && req.target) addApproved(req.target, req.scope ?? "session")
      return ok
    },
  }

  // Live event fan-out. The prompt run emits streamed model/tool events through
  // a small hook so a shell can render incrementally without polling the log.
  // Each listener is isolated: a throwing/slow listener must not corrupt the
  // turn loop's settlement path.
  const listeners = new Set<(event: AppEvent) => void>()
  const emit = (event: AppEvent): void => {
    for (const l of listeners) {
      try {
        l(event)
      } catch {
        // A broken listener must never sink the run.
      }
    }
  }
  const onEvent = (listener: (event: AppEvent) => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  let current: AbortController | undefined
  let inFlight = false

  // Model-io trace: every LLM call this session makes is appended as a durable
  // Session.ModelCalled event (source-tagged), so /events + usage folding see
  // the full call surface. Bodies are never logged — counts and metadata only.
  // providerId records the registry identity (explicit profile wins over kind)
  // so usage accounting stays honest when multiple profiles share a kind.
  const providerId = config.provider.providerId ?? config.provider.kind
  const traceModelCall = async (
    source: "turn" | "compaction" | "extraction",
    info: { model: string; durationMs: number; finish?: string; usage?: unknown; promptChars: number; outputChars: number; error?: string },
  ): Promise<void> => {
    await events.append(sessionId, "Session.ModelCalled", { sessionId, source, providerId, ...info, ts: Date.now() } as Record<string, unknown>)
  }

  // Compaction summarizer (shared by the loop's auto path and the manual
  // POST /compact): the app's own LLM folds the head (provider-agnostic —
  // any LlmClient). A failure/timeout inside compactSession falls back to
  // the local marker; here we only convert the stream to text.
  const compactSummarize = async (headText: string, signal?: AbortSignal): Promise<string> => {
    const started = performance.now()
    const stream = await llm.stream({ model: config.model, messages: [
      { role: "system", content: [{ type: "text", text: "Summarize the conversation head in under 200 words. Capture the objective, decisions made, and current state. Output only the summary." }] },
      { role: "user", content: [{ type: "text", text: headText }] },
    ] }, signal)
    let out = ""
    for await (const ev of stream) {
      if (ev.type === "text.delta") out += ev.text
    }
    const text = out.trim()
    await traceModelCall("compaction", {
      model: config.model,
      durationMs: Math.round(performance.now() - started),
      promptChars: headText.length,
      outputChars: text.length,
    })
    return text
  }

  /** Drive the turn loop over the current inbox WITHOUT admitting new text.
   *  prompt() is the admitting caller; compact() uses this to wake steers
   *  parked during a fold. inFlight lifecycle is owned by the CALLER (this
   *  path clears only the live registration + current controller). */
  const runDrain = async (principal: "user" | "butler" | "parent", promptId?: string): Promise<PromptResult> => {
    // A fresh abort controller per run, so interrupt() cancels only this
    // run and a later prompt is unaffected (an AbortSignal cannot be reset).
    const ctrl = new AbortController()
    current = ctrl
    // Live-session registration (M4 session manager): the butler hub can now
    // interrupt THIS session (abort) and send it a steer (admit) — so
    // `send_to_session`/`interrupt` from another butler tool are REAL.
    const unregisterLive = hub ? hub.register(sessionId, {
      abort: () => ctrl.abort(),
      admit: (text) => inbox.admit({ id: crypto.randomUUID(), sessionId, prompt: text, delivery: "steer", principal: "butler" }).then(() => {}),
    }) : undefined
    const caller: Initiator = principal === "user" ? { kind: "user" } : asButler ? { kind: "butler", sessionId } : { kind: "parent", sessionId }
    // Output layer (the panel seam): tools declaring `presents` derive a
    // durable Session.PanelPosted + a live `panel` LoopEvent per successful
    // result — shells render them in a dedicated surface (right column),
    // the CLI prints a text line. Failure results never present. The maps
    // fill per prompt (liveSurface is rebuilt each drain).
    const presentsByTool = new Map<string, NonNullable<Tool["presents"]>>()
    // `callId` is the only safe key when parallel calls share a tool name.
    const lastToolInput = new Map<string, unknown>()
    const appendPanel = async (p: NonNullable<Tool["presents"]>, input: unknown, output: unknown): Promise<void> => {
      const panelId = crypto.randomUUID()
      const payload = p.toPanel(input, output)
      const title = p.title?.(input, output) ?? `${p.kind} panel`
      await events.append(sessionId, "Session.PanelPosted", { sessionId, panelId, kind: p.kind, title, payload, ts: Date.now() })
      emit({ type: "panel", panelId, kind: p.kind, title, payload })
    }
    const onLoopEvent = (ev: AppEvent): void => {
      if (ev.type === "tool") lastToolInput.set(ev.callId, ev.input)
      else if (ev.type === "tool-result" && !ev.isError) {
        const p = presentsByTool.get(ev.name)
        if (p) void appendPanel(p, lastToolInput.get(ev.callId), ev.output).catch(() => {})
      }
      emit(ev)
    }
    try {
      // Per-prompt tool surface from the CURRENT policy (+ request_mode in
      // readonly so the model can ask to leave plan mode).
      liveSurface.length = 0
      liveSurface.push(...applyPolicy(agentTools, currentPolicy), ...(currentPolicy === "readonly" ? [requestModeTool] : []))
      // Output layer (the panel seam): refill the presents map from THIS
      // prompt's live surface (it is rebuilt per drain).
      presentsByTool.clear()
      for (const t of liveSurface) if (t.presents) presentsByTool.set(t.name, t.presents)
      lastToolInput.clear()
      const promptAgent: Agent = { ...agent, model: activeModel, tools: liveSurface }
      const result = await runSession(runtime, {
        agent: promptAgent,
        sessionId,
        resolveTool: (name) => liveSurface.find((t) => t.name === name),
        onEvent: onLoopEvent,
        signal: ctrl.signal,
        caller,
        ...(promptId ? { promptId } : {}),
        runHooks: hookRunner,
        contextWindowTokens: config.contextWindowTokens,
        maxOutputTokens: config.maxOutputTokens,
        ...(config.charsPerToken !== undefined ? { charsPerToken: config.charsPerToken } : {}),
        ...(config.toolOutputMaxChars !== undefined ? { toolOutputMaxChars: config.toolOutputMaxChars } : {}),
        ...(config.toolResultKeepRecent !== undefined ? { toolResultKeepRecent: config.toolResultKeepRecent } : {}),
        onModelCall: (info) => traceModelCall("turn", info),
        compactSummarize,
        toolCtx: hub ? {
          registry,
          appendAudit,
          interruptTarget: hub.interrupt,
          sendToTarget: hub.send,
          archiveTarget: (sessionId, archived = true) =>
            events.append(sessionId, "Session.Archived", { sessionId, archived, ts: Date.now() }).then(() => ({ implemented: true, sessionId })),
          resumeTarget: hub.resume,
          spawnFrom: hub.spawn,
          setPolicy: (p) => app.setPolicy(p, "model"),
          ...(config.onAsk ? { askUser: config.onAsk } : {}),
          queryTask: async (taskId) => {
            const log = await events.read(taskId)
            const settled = log.find((e) => e.type === "Session.Settled")
            if (settled) {
              const finish = (settled.data as { finish?: string }).finish
              return { state: "settled", finish, text: await readChildText(events, taskId) }
            }
            return { state: log.some((e) => e.type === "Session.Created") ? "running" : "unknown" }
          },
          ...(dagRunner
            ? {
                declareDag: (spec: unknown) =>
                  dagRunner.run(spec as DAGSpec, {
                    workspace,
                    todoSessionId: sessionId,
                    // Node children live-register with THIS session's hub: the
                    // declarer can interrupt/steer a running node's child like
                    // a spawn_agent child (trackable + communicable, not dead rows).
                    registerChildLive: (childId, register) => hub!.register(childId, register),
                  }),
              }
            : {}),
          execPolicy: currentPolicy === "trusted" ? allowAllExecPolicy : execPolicySession,
        } : { registry, appendAudit, setPolicy: (p) => app.setPolicy(p, "model"), ...(config.onAsk ? { askUser: config.onAsk } : {}), execPolicy: currentPolicy === "trusted" ? allowAllExecPolicy : execPolicySession },
      })
      // Post-turn memory extraction (opt-in, fire-and-forget): the default
      // pipe uses the app's own LLM client + model; runMemoryExtraction is
      // fail-closed, so a broken LLM is a no-op, never a failed turn.
      const memStore = config.memoryStore
      if (memStore && config.memoryExtract?.enabled) {
        void (async () => {
          try {
            const session = Session.replay(await events.read(sessionId))
            const recent = session.messages
              .filter((m) => m.kind === "user" || m.kind === "assistant")
              .slice(-30)
              .map((m) => ({ role: m.kind === "user" ? "user" : "assistant", text: m.kind === "user" ? (m as { text: string }).text : (m as { content: { type?: string; text?: string }[] }).content.filter((p) => p.type === "text").map((p) => p.text!).join("\n") }))
              .filter((m) => m.text.trim().length > 0)
            if (recent.length > 0 && (!config.memoryExtract?.shouldExtract || config.memoryExtract.shouldExtract({ step: result.step, finish: result.finish }, sessionId))) {
              const pipe = createDefaultMemoryPipeline(llm, config.model)
              const recentCount = config.memoryExtract?.recentCount ?? 30
              await runMemoryExtraction(pipe, memStore, { messages: recent.slice(-recentCount), sessionId })
            }
          } catch (err) {
            void err // best-effort; memory extraction must never poison the turn
          }
        })()
      }
      return { step: result.step, needsContinuation: result.needsContinuation, finish: result.finish }
    } finally {
      unregisterLive?.()
      if (current === ctrl) current = undefined
    }
  }

  const app: App = {
    sessionId,
    events,
    ...(attachmentStore ? { attachments: attachmentStore } : {}),
    onEvent,
    async prompt(text: string, principal?: "user" | "butler" | "parent", images?: readonly PromptImage[], opts?: { replace?: boolean; promptId?: string }): Promise<PromptResult> {
      // Task replacement (codex TurnAbortReason::Replaced semantics): with
      // replace:true a live run is aborted and DRAINED before the new prompt
      // admits — the new prompt owns the session cleanly instead of queueing
      // behind work it just declared obsolete. Bounded wait (10s): a hung
      // settle falls through to the normal busy semantics.
      if (opts?.replace && inFlight) {
        current?.abort()
        for (let i = 0; i < 400 && inFlight; i++) await new Promise((r) => setTimeout(r, 25))
        // Replace is an OWNERSHIP request, not a queue request: if the old
        // drain refuses to settle, a concurrent fallback would double-
        // promote on one log — refuse honestly instead.
        if (inFlight) throw new Error("session busy (replace timeout)")
      }
      // Refuse concurrent prompts outright: two runSession loops over one
      // aggregate would interleave duplicate assistant/tool events into the
      // durable log (the inbox's admission ordering protects double-PROMOTION,
      // not double-DRIVING), and the second run's finally would clear the busy
      // flag under the first. Mid-turn input belongs in steer (the admission
      // inbox); replace:true above is the explicit takeover path.
      if (inFlight) throw new Error("session busy")
      inFlight = true
      const effPrincipal = principal ?? (asButler ? "butler" : "parent")
      const admittedPromptId = opts?.promptId ?? crypto.randomUUID()
      try {
        // Ambient workspace AGENTS.md is a Context Source: discovered from the
        // session location and admitted as model-visible context BEFORE the prompt,
        // per the "model-visible ⟺ logged" rule. It is appended only once: once a
        // system message is already in the log we reuse it, so repeated prompts in
        // a session do not keep re-inserting the same context.
        await ensureSystemContext(events, sessionId, workspace, asButler ? withRoleBody(contextProvider, BUTLER_BODY) : contextProvider)
        // user-prompt-submit (claude-code semantics): a block DENIES the
        // prompt pre-admission — no prompt rows are admitted. (The ambient
        // system context above is already durable by design and deduped for
        // the next allowed prompt.) Runs BEFORE image prep so a denial never
        // stores orphaned attachment bytes.
        const submitVerdict = await hookRunner?.("user-prompt-submit", { sessionId, prompt: text, principal: effPrincipal })
        if (submitVerdict?.decision === "block") throw new Error(`prompt denied by hook: ${submitVerdict.reason ?? "blocked"}`)
        // Attachment pipeline wave 1 (docs/agent-runtime-integrations.md §5):
        // bytes go to the content-addressed store ONCE, the log carries refs.
        // Budget gates run here (admission time) and are DETERMINISTIC: same
        // input always evicts the same images, oldest position first.
        let promptText = text
        let admittedAttachments: readonly AttachmentRef[] | undefined
        if (images?.length && attachmentStore) {
          const prepared = await preparePromptImages(text, images, attachmentStore)
          promptText = prepared.prompt
          admittedAttachments = prepared.attachments
        }
        await inbox.admit({
          id: admittedPromptId,
          sessionId,
          prompt: promptText,
          delivery: "steer",
          principal: effPrincipal,
          ...(admittedAttachments?.length ? { attachments: admittedAttachments } : {}),
          ...(!admittedAttachments?.length && images?.length ? { images } : {}), // no store configured → legacy inline path
        })
      } catch (e) {
        inFlight = false
        throw e
      }

      // The drain drives the turn loop over the inbox (runDrain owns ctrl +
      // live registration; prompt owns inFlight).
      try {
        return await runDrain(effPrincipal, admittedPromptId)
      } finally {
        inFlight = false
      }
    },
    isBusy: () => inFlight,
    async resume(): Promise<Session> {
      return Session.replay(await events.read(sessionId))
    },
    async compact() {
      if (inFlight) throw new Error("session busy")
      // Raise the busy flag for the fold's own duration: two concurrent manual
      // compacts would double-fold (duplicate markers + duplicate summarizer
      // cost), and a steer-wake drain must not start mid-fold.
      inFlight = true
      try {
        return await compactSession(events, sessionId, { summarize: compactSummarize, maxTailChars: compactionTailChars({ contextWindowTokens: config.contextWindowTokens }) })
      } finally {
        inFlight = false
        // A steer admitted mid-fold took the busy branch (admit-only) and
        // nothing would drain it — the message would sit in the inbox until an
        // unrelated prompt arrived. Wake the drain when steers are parked.
        void inbox.hasPending(sessionId, "steer").then((pending) => {
          if (!pending || inFlight) return
          inFlight = true
          void runDrain("user")
            .catch((e) => console.error(`[session ${sessionId}] post-compact drain failed:`, e instanceof Error ? e.message : e))
            .finally(() => {
              inFlight = false
            })
        }).catch(() => {})
      }
    },
    async listSessions(query) {
      await registry.refresh()
      return registry.list(query)
    },
    async audit(actorSessionId) {
      return registry.audit(actorSessionId)
    },
    interrupt() {
      current?.abort()
      void hookRunner?.("interrupt", { sessionId }).catch(() => {})
    },
    async exec(command, signal) {
      const bash = agentTools.find((t) => t.name === "bash")
      if (!bash) return { error: "bash unavailable — the session was created with bash off" }
      const ctx = {
        caller: { kind: "parent" as const, sessionId },
        sessionId,
        toolName: "bash",
        execPolicy: currentPolicy === "trusted" ? allowAllExecPolicy : execPolicySession,
      }
      return bash.execute({ command }, { ...ctx, ...(signal ? { signal } : {}) })
    },
    terminalWrite(input, mode = "command") {
      // A full command line gets the same treatment on both sides of the glass;
      // raw mode passes keystrokes (^C, REPL input) straight into the shell.
      if (mode === "raw") sharedTerminal.humanWrite(input)
      else sharedTerminal.humanSend(input)
    },
    terminalRead(since) {
      const r = sharedTerminal.read(Math.max(0, Math.floor(since)))
      return { cursor: r.cursor, text: r.text, alive: r.alive, activity: sharedTerminal.activity() }
    },
    terminalDispose() {
      sharedTerminal.dispose()
    },
    async setModel(model) {
      const trimmed = model.trim()
      if (!trimmed) throw new Error("model is required")
      activeModel = trimmed
      await events.append(sessionId, "Session.ModelSet", { sessionId, model: trimmed, ts: Date.now() })
    },
    async contextBreakdown() {
      // Char-based buckets (the client converts to token estimates with the
      // same chars-per-token as the loop): system prompt vs conversation vs
      // the tool surface the model must carry every turn (builtin vs MCP).
      const { messages: projected } = projectCompacted(await events.read(sessionId))
      let systemPromptChars = 0
      let messagesChars = 0
      for (const m of projected) {
        const size = JSON.stringify(m).length
        if (m.kind === "system") systemPromptChars += size
        else messagesChars += size
      }
      let builtinToolsChars = 0
      let mcpToolsChars = 0
      for (const t of agentTools) {
        const size = JSON.stringify({ name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? {} }).length
        if (t.name.startsWith("mcp__") || t.name.startsWith("mcp_")) mcpToolsChars += size
        else builtinToolsChars += size
      }
      return { systemPromptChars, messagesChars, builtinToolsChars, mcpToolsChars, otherChars: 0 }
    },
    async steer(text) {
      // An IDLE session never promotes on its own — the drain IS the promoter —
      // so a bare admit would sit unpromoted forever. When idle, wake through
      // the prompt path (it admits with delivery:"steer" AND drives the loop),
      // FIRE-AND-FORGET: the steer route is an admit-shaped fast call, and
      // driving the whole drain inside it would hold the HTTP request for the
      // entire run (no keepalives, proxy timeouts, LLM failures as 500s).
      // When busy, a plain admit is correct: the running drain promotes it at
      // the next safe provider-turn boundary (admission inbox semantics, §2.2).
      // prompt() raises `inFlight` synchronously, so two steers in one tick
      // cannot double-drive.
      if (!inFlight) {
        void app.prompt(text, "user").catch((e) => {
          // A wake denial (user-prompt-submit block) must not vanish —
          // stderr is the only surface here; the steer was not admitted.
          console.error("[steer] wake denied:", e instanceof Error ? e.message : e)
        })
        return
      }
      await inbox.admit({ id: crypto.randomUUID(), sessionId, prompt: text, delivery: "steer", principal: "user" })
    },
    async todos() {
      return currentTodos(await events.read(sessionId))
    },
    async goal() {
      return currentGoal(await events.read(sessionId)) ?? null
    },
    policy() {
      return currentPolicy
    },
    async setPolicy(policy, by: "host" | "model" = "host") {
      const from = currentPolicy
      if (from === policy) return
      currentPolicy = policy
      await events.append(sessionId, "Session.PolicyChanged", { sessionId, from, to: policy, by, ts: Date.now() })
    },
    async runCommand(text) {
      // Slash command (transport entry): "/name args". The seam is the plugin
      // registry's command capabilities — never a type branch here.
      const trimmed = text.trim()
      if (!trimmed.startsWith("/")) return undefined
      const space = trimmed.indexOf(" ")
      const name = trimmed.slice(1, space === -1 ? undefined : space).trim()
      const rawArgs = space === -1 ? "" : trimmed.slice(space + 1).trim()
      const args = rawArgs.split(/\s+/).filter(Boolean)
      if (!name) return undefined
      const cmd = pluginRegistry?.get("command", name)
      if (!cmd) return undefined
      const output = await cmd.run(args)
      // claude-code convention: `$ARGUMENTS` in the command body expands to the
      // typed argument string; untouched bodies are returned as-is.
      const argText = rawArgs
      if (typeof output === "string" && output.includes("$ARGUMENTS")) return output.replaceAll("$ARGUMENTS", argText)
      return output
    },
    async truncate(atSeq) {
      // In-place rewind: refuse a non-integer boundary; a no-op past the log is
      // harmless (truncate removes nothing, the boundary event is still a fact).
      if (!Number.isInteger(atSeq) || atSeq < 0) throw new Error(`invalid truncate boundary: ${atSeq}`)
      // The current head — a rewind beyond it is a no-op, but a rewind to a
      // negative seq would delete Session.Created and orphan the aggregate.
      const latest = await events.latestSeq(sessionId)
      const boundary = Math.min(atSeq, latest)
      if (boundary < 0) throw new Error("cannot truncate before session creation")
      await events.truncate(sessionId, boundary)
      await events.append(sessionId, "Session.Truncated", { sessionId, atSeq: boundary, by: "host", ts: Date.now() })
    },
  }

  return app
}

async function createStore(dataDir?: string): Promise<EventStore> {
  // Long-horizon work requires durable state: when a dataDir is given we back
  // the event log with SQLite so a restart reconstructs the session + pending
  // inbox from disk (see specs §2). Without a dataDir we fall back to memory.
  if (dataDir) {
    // Ensure the dir exists and surface a mkdir failure clearly rather than
    // letting SqliteEventStore.open crash with an opaque path error.
    await mkdir(dataDir, { recursive: true })
    try {
      await Bun.write(join(dataDir, ".keep"), "")
    } catch (e) {
      throw new Error(`cannot persist session state to "${dataDir}": ${e instanceof Error ? e.message : String(e)}`)
    }
    return SqliteEventStore.open(join(dataDir, "events.db"))
  }
  return new MemoryEventStore()
}
