import { Database } from "bun:sqlite"
import { join } from "node:path"
import { MemorySessionInput, SqliteEventStore, type EventStore, type DAGSpec } from "@newhorse/core"
import { createBuiltinTools } from "./tools"
import { makeLlmClient, type AdapterConfig, type Fetcher } from "@newhorse/llm"
import type { MemoryStore } from "@newhorse/memory"

/**
 * Server-side DAG runner (the client's 编排 page backing): builds a DURABLE
 * runtime over the dataDir's event store (aggregate "dag" — replayable and
 * resumable) and runs declared specs fire-and-forget. Provider/model resolve
 * through getters so settings changes reach the next run.
 */
export interface DagRunnerOpts {
  readonly dataDir: string
  readonly getProvider: () => AdapterConfig
  readonly getDefaultModel: () => string
  readonly getWorkspace: () => string
  readonly enableBash?: boolean
  readonly memoryStore?: MemoryStore
  readonly skillsDir?: string
  readonly events?: EventStore
  readonly todoSessionId?: string
  readonly fetch?: Fetcher
}

export interface DagNodeStatus {
  readonly node: string
  readonly state: "pending" | "running" | "succeeded" | "failed" | "skipped" | "aborted"
  readonly model?: string
  /** Declared edges from the durable DAG.Declared spec (the UI's lane grouping). */
  readonly dependsOn?: string[]
  /** The node's driven child session (from NodeResolved) — pull its transcript
   *  via GET /v1/session/:id/events to see what the node actually did. */
  readonly childSessionId?: string
}

export interface DagStatus {
  readonly dagId: string
  readonly nodes: DagNodeStatus[]
  readonly done: boolean
  readonly startedAt?: number
}

export interface DagRunner {
  /** Declare + run a spec (durable; awaited until the graph SETTLES — the
   *  endpoint calls this fire-and-forget and returns the dagId immediately). */
  readonly run: (spec: DAGSpec, opts?: {
    workspace?: string
    todoSessionId?: string
    /** Live registration for node children: the declaring session's hub can
     *  interrupt/steer a running node's child (M4 session manager). */
    registerChildLive?: (childId: string, register: { abort: () => void; admit: (text: string) => Promise<void> }) => () => void
  }) => Promise<{ dagId: string }>
  readonly status: (dagId: string) => Promise<DagStatus | undefined>
  readonly list: () => Promise<DagStatus[]>
  /** Abort a RUNNING graph: flips pending→skipped / running→aborted and appends
   *  DAG.Aborted (see dag-runner abortGraph). Unknown id throws; an already-done
   *  graph reports {aborted:false} instead of erroring. */
  readonly abort: (dagId: string) => Promise<{ aborted: boolean; note?: string }>
}

/** Fold DAG events for one aggregate into node statuses. */
function foldStatus(dagId: string, rows: Array<{ type: string; data: Record<string, unknown>; createdAt: number | null }>): DagStatus | undefined {
  if (rows.length === 0) return undefined
  const nodes = new Map<string, DagNodeStatus>()
  // Declared edges come from the durable DAG.Declared spec — the fold keeps
  // node STATE from lifecycle events and grafts the spec's dependsOn on top.
  let spec: DAGSpec | undefined
  let startedAt: number | undefined
  let done = true
  for (const r of rows) {
    if (startedAt === undefined && r.createdAt !== null) startedAt = r.createdAt
    if (r.type === "DAG.Declared") {
      spec = (r.data as { spec?: DAGSpec }).spec
      continue
    }
    const d = r.data as { nodeId?: string; model?: string; sessionId?: string }
    if (!d.nodeId) continue
    let state: DagNodeStatus["state"] = "pending"
    if (r.type === "DAG.NodeStarted") state = "running"
    else if (r.type === "DAG.NodeResolved") state = "succeeded"
    else if (r.type === "DAG.NodeFailed") state = "failed"
    else if (r.type === "DAG.NodeSkipped") state = "skipped"
    else if (r.type === "DAG.NodeAborted") state = "aborted"
    const prev = nodes.get(d.nodeId)
    // terminal states stick
    if (prev && (prev.state === "succeeded" || prev.state === "failed" || prev.state === "skipped" || prev.state === "aborted")) continue
    nodes.set(d.nodeId, { node: d.nodeId, state, model: d.model ?? prev?.model, ...(d.sessionId || prev?.childSessionId ? { childSessionId: d.sessionId ?? prev?.childSessionId } : {}) })
  }
  // Seed declared-but-unevented nodes as pending: a freshly declared graph (or
  // a not-yet-dispatched node) must read as not-done, never as an empty done.
  for (const id of Object.keys(spec?.nodes ?? {})) {
    if (!nodes.has(id)) nodes.set(id, { node: id, state: "pending" })
  }
  const dependsOnOf = (id: string): string[] | undefined => {
    const deps = spec?.nodes[id]?.dependsOn
    return deps && deps.length > 0 ? [...deps] : undefined
  }
  for (const n of nodes.values()) if (n.state === "running" || n.state === "pending") done = false
  return {
    dagId,
    nodes: [...nodes.values()]
      .map((n) => {
        const deps = dependsOnOf(n.node)
        return deps ? { ...n, dependsOn: deps } : n
      })
      .sort((a, b) => a.node.localeCompare(b.node)),
    done,
    startedAt,
  }
}

export function createDagRunner(opts: DagRunnerOpts): DagRunner {
  const events: EventStore = opts.events ?? SqliteEventStore.open(join(opts.dataDir, "events.db"))
  const inbox = new MemorySessionInput(events)
  const tools = createBuiltinTools({ workspace: opts.getWorkspace(), enableBash: opts.enableBash ?? false, memoryStore: opts.memoryStore, skillsDir: opts.skillsDir, events })
  const fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  // One AbortController per RUNNING graph; runDag's deps.signal drives
  // abortGraph (pending→skipped, running→aborted, durable DAG.Aborted).
  const controllers = new Map<string, AbortController>()

  const readStatus = async (dagId: string): Promise<DagStatus | undefined> => {
    const evs = await events.read(dagId).catch(() => [])
    return foldStatus(
      dagId,
      evs.map((e) => ({ type: e.type, data: e.data, createdAt: e.ts ?? null })),
    )
  }

  return {
    async run(spec, runOpts) {
      // Caller-supplied id: the endpoint returns it immediately while the
      // graph keeps driving fire-and-forget. A failed driver leaves the
      // Declared event absent — status() then reports undefined (honest).
      const dagId = crypto.randomUUID()
      const ctrl = new AbortController()
      controllers.set(dagId, ctrl)
      const { runDag } = await import("./dag-runner")
      void runDag(spec, {
        events,
        inbox,
        runtime: { events, inbox, llm: makeLlmClient(opts.getProvider(), fetch) },
        tools,
        workspace: runOpts?.workspace ?? opts.getWorkspace(),
        defaultModel: opts.getDefaultModel(),
        todoSessionId: runOpts?.todoSessionId ?? opts.todoSessionId,
        ...(runOpts?.registerChildLive ? { registerChildLive: runOpts.registerChildLive } : {}),
        dagId,
        signal: ctrl.signal,
      })
        .catch(() => {
          // Node failures are recorded on the dag aggregate; the runner never
          // throws past settlement.
        })
        .finally(() => controllers.delete(dagId))
      return { dagId }
    },
    status: readStatus,
    async abort(dagId) {
      // Status first: a settled graph whose controller cleanup has not run yet
      // (settle → finally window) must read "already done", not re-abort.
      const st = await readStatus(dagId)
      if (!st) throw new Error("unknown dag id")
      if (st.done) return { aborted: false, note: "already done" }
      const ctrl = controllers.get(dagId)
      if (ctrl) {
        ctrl.abort()
        return { aborted: true }
      }
      return { aborted: false, note: "not running" }
    },
    async list() {
      const db = new Database(join(opts.dataDir, "events.db"), { readonly: true })
      try {
        const ids = db.query("SELECT DISTINCT aggregate_id FROM event WHERE aggregate = 'dag' ORDER BY aggregate_id DESC").all() as { aggregate_id: string }[]
        const out: DagStatus[] = []
        for (const { aggregate_id } of ids) {
          const rows = db.query("SELECT type, data, created_at FROM event WHERE aggregate_id = ? AND aggregate = 'dag' ORDER BY seq ASC").all(aggregate_id) as Array<{ type: string; data: string; created_at: number | null }>
          const st = foldStatus(
            aggregate_id,
            rows.map((r) => ({ type: r.type, data: JSON.parse(r.data) as Record<string, unknown>, createdAt: r.created_at })),
          )
          if (st) out.push(st)
        }
        return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
      } finally {
        db.close()
      }
    },
  }
}
