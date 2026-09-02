import type { Tool, EventStore } from "@newhorse/core"
import { projectCompacted, clearStaleToolResults, compactLimit } from "@newhorse/core"

/**
 * Self-awareness tools (wave 9, docs/runtime-comparison.md §6.2): the model
 * could not answer "what am I, where am I, how much context is left" — codex
 * solves this with environment_context + get_context_remaining/current_time.
 * Every fact here is already in the app's closure or the log; the tools only
 * surface it. status/remaining/time are read-only (sideEffects: false);
 * sleep deliberately is not (it must vanish from the surface in plan mode).
 */

export interface SelfAwarenessOptions {
  readonly sessionId: string
  readonly workspace: string
  /** Human-readable product role: "newhorse 常驻会话" / "代理" / agent role. */
  readonly role: string
  readonly model: string
  readonly providerKind: string
  /** Config/data directories (self_status reports them so the model knows
   *  where its own configuration and durable state live). */
  readonly dataDir?: string
  readonly agentHome?: string
  readonly approvalPolicy: () => "strict" | "readonly" | "trusted"
  /** Live tool-surface size (a thunk: the surface is assembled after the
   *  builtin set that carries these tools). */
  readonly toolCount: () => number
  readonly events: EventStore
  /** Window scaling for get_context_remaining (same source as the loop's). */
  readonly contextWindowTokens?: number
  readonly toolResultKeepRecent?: number
  /** Chars-per-token for the estimate (mirror the loop's; default 2.5). */
  readonly charsPerToken?: number
}

export function createSelfTools(opts: SelfAwarenessOptions): Tool[] {
  const status: Tool = {
    name: "self_status",
    sideEffects: false,
    description: "Answer 'what am I and where am I': product identity, role, model, provider, session id, workspace, config directories, approval policy, tool surface size, platform, and the current time.",
    execute: async () => ({
      product: "newhorse",
      role: opts.role,
      model: opts.model,
      providerKind: opts.providerKind,
      sessionId: opts.sessionId,
      workspace: opts.workspace,
      ...(opts.dataDir ? { dataDir: opts.dataDir } : {}),
      ...(opts.agentHome ? { agentHome: opts.agentHome } : {}),
      approvalPolicy: opts.approvalPolicy(),
      tools: opts.toolCount(),
      platform: process.platform,
      time: new Date().toISOString(),
    }),
  }

  const remaining: Tool = {
    name: "get_context_remaining",
    sideEffects: false,
    description: "Report how much of the model context window is still free: visible history chars, estimated tokens, window size, and remaining budget. Use it to decide whether to wrap up or let compaction run.",
    execute: async () => {
      const stored = await opts.events.read(opts.sessionId)
      const { messages } = projectCompacted(stored)
      const cpt = opts.charsPerToken ?? 2.5
      const limit = compactLimit({ contextWindowTokens: opts.contextWindowTokens, charsPerToken: cpt })
      const visible = clearStaleToolResults(messages, { keepRecent: opts.toolResultKeepRecent, thresholdChars: limit, visibleChars: messages.reduce((n, m) => n + JSON.stringify(m).length, 0) })
      const chars = visible.reduce((n, m) => n + JSON.stringify(m).length, 0)
      const estTokens = Math.ceil(chars / cpt)
      return {
        visibleChars: chars,
        estTokens,
        ...(opts.contextWindowTokens ? { windowTokens: opts.contextWindowTokens, remainingTokens: Math.max(0, opts.contextWindowTokens - estTokens) } : { windowTokens: null }),
        compacted: stored.some((e) => e.type === "Session.Compacted"),
      }
    },
  }

  const time: Tool = {
    name: "current_time",
    sideEffects: false,
    description: "Current wall-clock time: ISO-8601 with timezone. The model has no innate clock — call this instead of guessing dates.",
    execute: async () => {
      const now = new Date()
      return { iso: now.toISOString(), epochMs: now.getTime(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    },
  }

  const sleep: Tool = {
    name: "sleep",
    description: "Wait for a bounded duration (e.g. polling a background process, rate-limit backoff). Args: { seconds } — clamped to [0.05, 60]; a session interrupt cancels the wait.",
    execute: async (input: unknown, ctx) => {
      const raw = (input as { seconds?: number }).seconds
      const seconds = Math.min(60, Math.max(0.05, Number.isFinite(raw) ? Number(raw) : 1))
      const deadline = Date.now() + seconds * 1_000
      while (Date.now() < deadline) {
        if (ctx?.signal?.aborted) return { slept: Number(((seconds * 1_000 - (deadline - Date.now())) / 1_000).toFixed(3)), aborted: true }
        await new Promise((r) => setTimeout(r, Math.min(100, deadline - Date.now())))
      }
      return { slept: seconds, aborted: false }
    },
  }

  return [status, remaining, time, sleep]
}
