import type { ApprovalRequest } from "@newhorse/schema"

/**
 * Interactive approval hub — the transport-side half of the client approval
 * UX. The engine's execpolicy gate calls `gate(request)` and AWAINS; the hub
 * parks the request as pending (the client UI polls `pending()`), and a
 * client decision via `resolve(id, allow)` completes the gate. A request that
 * is never answered auto-DENIES after the timeout (fail-closed, never blocks
 * a turn forever).
 */
export interface PendingApproval extends ApprovalRequest {
  readonly createdAt: number
  readonly expiresAt: number
}

export interface ApprovalHub {
  /** The engine-facing gate (createApp onApprove). */
  readonly gate: (req: ApprovalRequest) => Promise<boolean>
  /** Question channel: like gate, but the operator's reply text comes back
   *  (an option label or a custom answer). Auto-deny after the timeout. */
  readonly ask: (req: ApprovalRequest) => Promise<{ allow: boolean; reply?: string; scope?: "session" | "workspace" }>
  /** Currently pending requests (the client polls this). */
  readonly pending: () => PendingApproval[]
  /** Resolve one pending request; false when the id is unknown/settled.
   *  The optional scope (session|workspace) extends the approved-command
   *  memory beyond a single session. */
  readonly resolve: (id: string, allow: boolean, reply?: string, scope?: "session" | "workspace") => boolean
}

export function createApprovalHub(opts?: { timeoutMs?: number }): ApprovalHub {
  const timeoutMs = opts?.timeoutMs ?? 120_000
  const pending = new Map<string, { req: PendingApproval; resolve: (allow: boolean, reply?: string, scope?: "session" | "workspace") => void; timer?: ReturnType<typeof setTimeout> }>()
  const park = (req: ApprovalRequest): Promise<{ allow: boolean; reply?: string; scope?: "session" | "workspace" }> =>
    new Promise<{ allow: boolean; reply?: string; scope?: "session" | "workspace" }>((resolve) => {
      const entry: PendingApproval = { ...req, createdAt: Date.now(), expiresAt: Date.now() + timeoutMs }
      // Ref'd on purpose: the auto-deny MUST fire (fail-closed). Bun 1.3.x
      // unref'd timers were observed not to fire on an idle loop.
      //
      // `question` requests NEVER auto-deny: they are the agent asking the
      // operator to think (travel-plan trade-offs can take minutes) — an
      // unanswered question is answered by the operator pressing the dock's
      // "不作答" button, not by a timer. Execpolicy gates keep the timeout
      // (fail-closed around side effects).
      const isQuestion = req.kind === "question"
      const timer = isQuestion ? undefined : setTimeout(() => {
        if (pending.get(req.id)) {
          pending.delete(req.id)
          resolve({ allow: false })
        }
      }, timeoutMs)
      pending.set(req.id, {
        req: entry,
        timer,
        resolve: (allow: boolean, reply?: string, scope?: "session" | "workspace") => resolve({ allow, ...(reply !== undefined ? { reply } : {}), ...(scope ? { scope } : {}) }),
      })
    })
  return {
    gate: async (req) => (await park(req)).allow,
    ask: park,
    pending: () => [...pending.values()].map((p) => p.req).sort((a, b) => a.createdAt - b.createdAt),
    resolve(id, allow, reply, scope) {
      const entry = pending.get(id)
      if (!entry) return false
      clearTimeout(entry.timer)
      pending.delete(id)
      entry.resolve(allow, reply, scope)
      return true
    },
  }
}
