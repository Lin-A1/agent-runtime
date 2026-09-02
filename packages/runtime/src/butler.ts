import type { Initiator, Tool, ToolCtx, SessionRow } from "@newhorse/core"
import type { SessionRegistry } from "@newhorse/core"

/**
 * Butler tools (M2b). These are ordinary `Tool`s whose `execute` receives a
 * `ToolCtx` carrying the trusted `caller` (injected by the loop). Each tool
 * enforces its own authorization inside `execute` — reading `ctx.caller` (never
 * the model's payload) and `ctx.registry` — and appends an audit entry for both
 * allowed and denied decisions.
 *
 * The authority model (see specs/v2/m2b-butler-authority.md):
 *   - list_sessions: any caller allowed (observation).
 *   - interrupt: butler wide (any session), parent scoped to direct children,
 *     user any. targetRequired.
 *   - spawn_agent: any caller may spawn; spawner becomes the parent.
 *   - send_to_session: default-deny; only user, or parent to its direct child.
 *     targetRequired.
 *   - declare_dag: butler submits a declarative DAG spec (no target session);
 *     the runtime schedules it and projects progress into the declaring
 *     session's todo list. Audited on success like spawn_agent.
 */
export interface ButlerDeps {
  readonly registry: SessionRegistry
  readonly appendAudit: (entry: { actorKind: "user" | "butler" | "parent"; actorId: string; op: string; targetSessionId?: string; outcome: "allowed" | "denied"; reason?: string }) => Promise<void>
}

interface Decision {
  allowed: boolean
  reason?: string
}

/** Common helper: resolve target, short-circuit unknown, authorize, audit. */
async function guarded(
  deps: ButlerDeps,
  ctx: ToolCtx,
  op: string,
  targetId: string | undefined,
  needsTarget: boolean,
  authorize: (caller: Initiator, target?: SessionRow) => Decision,
  run: () => Promise<unknown>,
): Promise<unknown> {
  const actorId = ctx.sessionId ?? (ctx.caller.kind === "user" ? "user" : ctx.caller.sessionId)

  let target: SessionRow | undefined
  if (targetId) {
    // Refresh so a just-spawned child is visible (registry is a lazy projection).
    await deps.registry.refresh()
    target = await deps.registry.get(targetId)
  }

  // needsTarget tools: a missing/unknown target is denied before authorize.
  const decision = needsTarget && !target ? { allowed: false, reason: "unknown target" } : authorize(ctx.caller, target)
  await deps.appendAudit({ actorKind: ctx.caller.kind, actorId, op, targetSessionId: targetId, outcome: decision.allowed ? "allowed" : "denied", reason: decision.reason })
  if (!decision.allowed) throw new Error(`denied: ${decision.reason ?? "unknown target"}`)
  return run()
}

function requireCtx(ctx?: ToolCtx): ToolCtx {
  if (!ctx) throw new Error("butler tool missing ctx")
  return ctx
}

/** Clamp a number into [lo, hi]; a non-finite input falls to lo (never NaN). */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n) || n < lo) return lo
  return n > hi ? hi : n
}

/** Build the four butler tools as a registry-backed list. */
export function createButlerTools(deps: ButlerDeps): Tool[] {
  return [
    {
      name: "list_sessions",
      sideEffects: false,
      description: "List sessions (observational, read-only).",
      execute: async (input: unknown, ctx?: ToolCtx) => {
        requireCtx(ctx)
        // The registry index is lazily hydrated and only refreshed when a target
        // is present. The butler's whole purpose is to observe the session tree,
        // so a freshly spawned child (already durable in the store) must be
        // visible here — refresh before listing, matching the app-level view.
        await deps.registry.refresh()
        return deps.registry.list(input as never)
      },
    },
    {
      name: "followup_task",
      sideEffects: false,
      description: "Query a task's durable state by its task id (childSessionId from spawn_agent): running / settled / unknown, plus the result text when settled.",
      execute: async (input: unknown, ctx?: ToolCtx) => {
        const c = requireCtx(ctx)
        const taskId = (input as { taskId?: string }).taskId
        if (!taskId) throw new Error("taskId is required")
        const res = await c.queryTask?.(taskId)
        if (!res) return { authorization: "allowed", state: "unknown", error: "queryTask not available" }
        return { authorization: "allowed", taskId, state: res.state, finish: res.finish, text: res.text }
      },
    },
    {
      name: "wait_agent",
      description: "Block until a task settles (by its task id from spawn_agent) or the timeout elapses. Args: { taskId, timeoutMs? } — subject clamps to 1-120000ms (default 30000); returns the settled result text or the still-running state on timeout.",
      execute: async (input: unknown, ctx?: ToolCtx) => {
        const c = requireCtx(ctx)
        const taskId = (input as { taskId?: string }).taskId
        const rawTimeout = (input as { timeoutMs?: number }).timeoutMs
        if (!taskId) throw new Error("taskId is required")
        if (!c.queryTask) return { authorization: "allowed", taskId, state: "unknown", error: "queryTask not available" }
        // Clamp (codex wait.rs semantics): min 1s, max 120s, default 30s — a
        // garbage value never becomes a 1ms kill or an unbounded hang.
        const timeoutMs = clamp(Math.floor(rawTimeout ?? 30_000), 1_000, 120_000)
        const deadline = Date.now() + timeoutMs
        let res = await c.queryTask(taskId)
        while (res.state === "running" && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250))
          res = await c.queryTask(taskId)
        }
        return { authorization: "allowed", taskId, state: res.state, finish: res.finish, text: res.text, timedOut: res.state === "running" }
      },
    },
    {
      name: "interrupt",
      description: "Interrupt a running session. Butler may interrupt any; a parent only its direct child.",
      execute: async (input: unknown, ctx?: ToolCtx) => {
        const c = requireCtx(ctx)
        const targetId = (input as { target?: string }).target
        return guarded(deps, c, "interrupt", targetId, true, (caller, target) => {
          if (caller.kind === "user") return { allowed: true }
          if (caller.kind === "butler") return { allowed: true }
          return target && target.parentId === caller.sessionId ? { allowed: true } : { allowed: false, reason: "only your direct child session" }
        }, async () => {
          const res = await c.interruptTarget?.(targetId!)
          // Report the hub's actual outcome; never claim an effect a stub
          // did not apply.
          return { authorization: "allowed", targetId, implemented: res?.implemented ?? false, pending: res?.pending ?? true }
        })
      },
    },
    {
      name: "spawn_agent",
      description: "Spawn a new agent session; the spawner becomes its parent. Args: { prompt: task instruction, model?: model id overrides default, agent?: a named agent role from the plugin registry (identity + tool whitelist + specialism body) }.",
      execute: async (input: unknown, ctx?: ToolCtx) => {
        const c = requireCtx(ctx)
        const model = (input as { model?: string }).model
        const prompt = (input as { prompt?: string }).prompt
        const agentName = (input as { agent?: string }).agent
        const parentId = c.caller.kind === "user" ? "user" : c.caller.sessionId
        // spawn has no target; always allowed, but MUST be audited — appendAudit
        // is required (audit is not optional for butler actions).
        if (!c.appendAudit) throw new Error("butler tool missing appendAudit")
        const child = await c.spawnFrom?.(parentId, model, prompt, agentName)
        await c.appendAudit({ actorKind: c.caller.kind, actorId: c.sessionId ?? parentId, op: "spawn_agent", targetSessionId: child, outcome: "allowed", reason: undefined })
        return { authorization: "allowed", model, agent: agentName, parentId, childSessionId: child, implemented: child !== undefined }
      },
    },
    {
      name: "send_to_session",
      description: "Send a message to another session. Default-deny: only user, or a parent to its direct child.",
      execute: async (input: unknown, ctx?: ToolCtx) => {
        const c = requireCtx(ctx)
        const targetId = (input as { target?: string }).target
        const content = (input as { content?: string }).content
        return guarded(deps, c, "send_to_session", targetId, true, (caller, target) => {
          if (caller.kind === "user") return { allowed: true }
          if (caller.kind === "parent") return target && target.parentId === caller.sessionId ? { allowed: true } : { allowed: false, reason: "only your direct child session" }
          return { allowed: false, reason: "butler requires explicit user authorization" }
        }, async () => {
          const res = await c.sendToTarget?.(targetId!, content ?? "")
          return { authorization: "allowed", targetId, content, implemented: res?.implemented ?? false, pending: res?.pending ?? true }
        })
      },
    },
    {
      name: "declare_dag",
      sideEffects: true,
      description: "Declare a DAG of subagent nodes for PLANNED parallel work: submit { spec: { nodes: { [id]: { agent: { name: string, role?: string, model?: string }, input: string, dependsOn?: string[] } } } } and the runtime drives the whole graph (topo order, readiness wakeups, per-node models, crash-resumable) while node progress projects into this session's todo list. Returns { dagId, nodes }. Fire-and-forget — collect results later with followup_task / list_sessions. Use spawn_agent instead for one-off dynamic spawns.",
      execute: async (input: unknown, ctx?: ToolCtx) => {
        const c = requireCtx(ctx)
        const spec = (input as { spec?: { nodes?: Record<string, unknown> } }).spec
        if (!spec || typeof spec !== "object" || !spec.nodes || typeof spec.nodes !== "object" || Object.keys(spec.nodes).length === 0) {
          throw new Error("spec.nodes is required (at least one node)")
        }
        if (!c.declareDag) throw new Error("declareDag not available (no dag runner configured)")
        if (!c.appendAudit) throw new Error("butler tool missing appendAudit")
        const res = await c.declareDag(spec)
        await c.appendAudit({ actorKind: c.caller.kind, actorId: c.sessionId ?? (c.caller.kind === "user" ? "user" : c.caller.sessionId), op: "declare_dag", outcome: "allowed", reason: undefined })
        return { authorization: "allowed", dagId: res.dagId, nodes: Object.keys(spec.nodes).length }
      },
    },
  ]
}
