import { Session } from "../session/session"
import type { EventStore } from "../session/store"
import type { SessionMessage, StoredEvent } from "@newhorse/schema"

/**
 * Local compaction (AGENTS.md goal #2 — long-horizon, no remote-only behavior;
 * codex's remote compaction is explicitly rejected).
 *
 * The first, honest version is a LOCAL fold, not an LLM summary: it preserves
 * the durable boundary (`Session.Compacted`), keeps the tail of the history
 * verbatim (most recent turns), and collapses the head into a single
 * `[previous context]` marker message so the next request stays well-formed
 * (context window bounded) without a remote summarization call. An LLM-summary
 * compaction (a second, richer boundary) can slot into the same seam later.
 *
 * Principle: "model-visible ⟺ logged" — the compacted boundary and the
 * collapsed message are durable events in the log; the model's view is the log
 * projection, never a fresh in-memory rewrite.
 */

export interface CompactOptions {
  /** Keep this many most-recent messages verbatim. Default 12. */
  readonly retain?: number
  /** Abort signal from the driving turn (cancelled = interrupt). */
  readonly signal?: AbortSignal
  /** Byte budget for the retained tail (the same JSON-chars measure the
   *  trigger uses). A COUNT-only retain makes no promise about tail size —
   *  one 50k-char file-read message twelve times over still overflows a
   *  small window. When the newest messages exceed this budget, the count
   *  cap shrinks so the overflow folds into the summarized head instead.
   *  Derived from the model window when known; default 30_000 chars. */
  readonly maxTailChars?: number
  /** Optional LLM summarizer: (folded head text, abort signal) -> summary.
   *  When absent, a cheap LOCAL marker ("[previous context: N messages
   *  folded...]") is used. The seam keeps compaction provider-agnostic — the
   *  caller (runtime) injects the summary call; a broken summarizer fails back
   *  to the local marker. The signal lets an interrupt cancel the summary
   *  stream instead of letting it burn tokens in the background. */
  readonly summarize?: (headText: string, signal?: AbortSignal) => Promise<string>
  /** Cap on the head text handed to the summarizer (chars). Default 30_000 —
   *  scale it with the model window: a 200k-token model can summarize far
   *  more head than a 32k-token one. */
  readonly summarizeMaxChars?: number
  /** Hard timeout for the summarizer. Default scales with the prompt size
   *  (see summarizeTimeoutMs) — a fixed 10s silently degraded to the local
   *  marker exactly on the biggest (most summary-worthy) heads. */
  readonly summarizeTimeoutMs?: number
}

/** Summarizer timeout scaled to the prompt it must read: ~2.5k chars/s of
 *  provider throughput, floored at 10s (small heads still need model latency). */
export function summarizeTimeoutMs(promptChars: number): number {
  return Math.max(10_000, Math.ceil(promptChars / 2_500) * 1_000)
}

/** Compaction: keep the newest messages verbatim (count-capped by `retain`
 *  AND byte-capped by `maxTailChars` — whichever is tighter), fold everything
 *  older into a compacted marker, and append the durable boundary. Returns
 *  the new head seq. */
export async function compactSession(events: EventStore, sessionId: string, opts: CompactOptions = {}): Promise<{ boundarySeq: number; summary: string }> {
  const retain = Math.max(2, opts.retain ?? 12)
  const stored = await events.read(sessionId)
  const messages: SessionMessage[] = []
  const messageSeqs: number[] = []
  for (const e of stored) {
    if (e.type === "Session.MessageAppended") {
      messages.push((e.data as { message?: SessionMessage }).message!)
      messageSeqs.push(e.seq)
    } else if (e.type === "Session.Prompted") {
      const d = e.data as { id?: string; prompt?: string }
      if (d.id && typeof d.prompt === "string") {
        messages.push({ kind: "user", id: d.id, seq: e.seq, text: d.prompt })
        messageSeqs.push(e.seq)
      }
    }
  }
  // Effective keep: newest messages that fit BOTH the count cap and the byte
  // budget (always at least one — the newest exchange is the working context;
  // a single message larger than the whole budget still stays, documented).
  let keep = Math.min(retain, messages.length)
  if (opts.maxTailChars !== undefined) {
    let chars = 0
    let fit = 0
    for (let i = messages.length - 1; i >= 0 && fit < retain; i--) {
      const c = JSON.stringify(messages[i]!).length
      if (chars + c > opts.maxTailChars && fit > 0) break
      chars += c
      fit++
    }
    keep = Math.min(keep, Math.max(fit, 1))
  }
  const headCount = messages.length - keep
  if (headCount <= 0) {
    // Nothing to compact — no boundary to write (the session is already small).
    return { boundarySeq: stored.at(-1)?.seq ?? -1, summary: "" }
  }
  const head = messages.slice(0, headCount)
  const tail = messages.slice(headCount)
  // boundarySeq = the LAST seq of the folded head. A read-time projection that
  // honors the boundary drops every MessageAppended with seq <= boundarySeq
  // (the head is represented by the summary marker), keeping ONLY the tail.
  const boundarySeq = messageSeqs[headCount - 1]!  // Summary of the collapsed head: an LLM summary when injected (compact the
  // head text), else the cheap local marker (counts + first prompt gist).
  const headText = head.map((m) => (m.kind === "user" ? m.text : m.kind === "assistant" ? (m as { content?: { type?: string; text?: string }[] }).content?.filter((p) => p.type === "text").map((p) => p.text!).join("\n") ?? "" : "")).join("\n\n")
  let summary: string
  if (opts.summarize) {
    try {
      // Race the summarizer against a hard timeout: a hung LLM must not stall
      // the turn; on timeout/failure the cheap local marker stands in. The
      // timeout scales with the prompt actually sent — a fixed 10s degraded
      // to the local marker exactly on the biggest heads.
      const prompt = headText.slice(0, opts.summarizeMaxChars ?? 30_000)
      const result = await Promise.race([
        // The loser of the race must never surface a late unhandled rejection
        // (a summarizer failing AFTER the timeout resolved would crash the
        // process) — swallow it: the local marker already stood in.
        opts.summarize(prompt, opts.signal).then((s) => `[previous context] ${s}`).catch(() => ""),
        new Promise<string>((r) => setTimeout(() => r(""), opts.summarizeTimeoutMs ?? summarizeTimeoutMs(prompt.length))),
      ])
      summary = result || localSummary(headCount, head)
    } catch {
      summary = localSummary(headCount, head)
    }
  } else {
    summary = localSummary(headCount, head)
  }
  // Append the compaction marker (a user-role message so it is a normal part of
  // history; the encoders map kind "compaction" → user, and the model sees it
  // as a context stub, never a fake assistant claim).
  const session = Session.replay(stored)
  const marker = session.projectMessage({ kind: "compaction", id: crypto.randomUUID(), seq: 0, text: summary })
  await events.append(sessionId, marker.type, marker.data as Record<string, unknown>)
  await events.append(sessionId, "Session.Compacted", { sessionId, boundarySeq, summary, retainedFrom: tail.length })
  return { boundarySeq, summary }
}

/**
 * Read-time projection honoring the LAST compaction boundary: drop every
 * MessageAppended at seq <= boundarySeq (that head is represented by the
 * summary marker), keep the tail. This is what actually bounds the next
 * request — the full log is still durable (append-only), the model just sees
 * the compacted view. A session with no boundary returns its messages as-is.
 */
/** Cheap local summary (no LLM): counts + the first user prompt's gist. */
function localSummary(headCount: number, head: SessionMessage[]): string {
  const userPrompt = head.find((m) => m.kind === "user")?.text ?? ""
  return `[previous context: ${headCount} messages folded; original request: ${userPrompt.slice(0, 120)}${userPrompt.length > 120 ? "…" : ""}]`
}

export function projectCompacted(stored: StoredEvent[]): { messages: SessionMessage[]; boundary: number } {
  const boundaryEvent = [...stored].reverse().find((e) => e.type === "Session.Compacted")
  const boundary = boundaryEvent ? Number((boundaryEvent.data as { boundarySeq?: number }).boundarySeq ?? -1) : -1
  // Image attachments ride the PromptAdmitted event (refs) or inline; the
  // Prompted promotion does NOT copy them. Any projection that rebuilds user
  // messages from Prompted alone DROPS the images — the model then literally
  // never sees them (resolveAttachmentImages finds no refs to hydrate). So
  // build the id → attachments/images index first and graft it back.
  const admitted = new Map<string, { attachments?: Array<{ sha256: string; mime: string; bytes: number }>; images?: Array<{ mime: string; data: string }> }>()
  for (const e of stored) {
    if (e.type !== "Session.PromptAdmitted") continue
    const d = e.data as { id?: string; attachments?: Array<{ sha256: string; mime: string; bytes: number }>; images?: Array<{ mime: string; data: string }> }
    if (!d.id) continue
    if (d.attachments?.length || d.images?.length) admitted.set(d.id, { ...(d.attachments?.length ? { attachments: d.attachments } : {}), ...(d.images?.length ? { images: d.images } : {}) })
  }
  const grafted = (id: string | undefined): { images?: unknown[]; attachments?: unknown[] } =>
    id ? admitted.get(id) ?? {} : {}
  if (boundary < 0) {
    const messages: SessionMessage[] = []
    for (const e of stored) {
      if (e.type === "Session.MessageAppended") messages.push((e.data as { message?: SessionMessage }).message!)
      else if (e.type === "Session.Prompted") {
        const d = e.data as { id?: string; prompt?: string }
        if (d.id && typeof d.prompt === "string") {
          const extra = grafted(d.id)
          messages.push({
            kind: "user",
            id: d.id,
            seq: e.seq,
            text: d.prompt,
            ...(extra.images?.length ? { images: extra.images } : {}),
            ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
          } as SessionMessage)
        }
      }
    }
    return { messages, boundary }
  }

  // With a boundary:
  // 1. Preserve ambient system context (AGENTS.md): system instructions from
  // the log must survive compaction as ambient root instructions
  const systemMessages: SessionMessage[] = []
  for (const e of stored) {
    if (e.type === "Session.MessageAppended") {
      const m = (e.data as { message?: SessionMessage }).message!
      if (m.kind === "system") systemMessages.push(m)
    }
  }

  // 2. Extract the compaction marker and raw messages beyond the boundary
  let markerMsg: SessionMessage | null = null
  const rawTail: SessionMessage[] = []
  for (const e of stored) {
    if (e.seq <= boundary) continue
    if (e.type === "Session.MessageAppended") {
      const m = (e.data as { message?: SessionMessage }).message!
      if (m.kind === "compaction") {
        markerMsg = m
      } else if (m.kind !== "system") {
        rawTail.push(m)
      }
    } else if (e.type === "Session.Prompted") {
      const d = e.data as { id?: string; prompt?: string }
      if (d.id && typeof d.prompt === "string") {
        const extra = grafted(d.id)
        rawTail.push({
          kind: "user",
          id: d.id,
          seq: e.seq,
          text: d.prompt,
          ...(extra.images?.length ? { images: extra.images } : {}),
          ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
        } as SessionMessage)
      }
    }
  }

  // If no explicit marker was found in events, construct one from the boundary event summary
  if (!markerMsg) {
    const summary = String((boundaryEvent?.data as { summary?: string })?.summary ?? "[previous context folded]")
    markerMsg = { kind: "compaction", id: crypto.randomUUID(), seq: 0, text: summary }
  }

  // 3. Clean orphan tools from rawTail: any tool message whose call was folded
  // into the head (no matching tool-call in the visible tail) must be dropped
  const knownCalls = new Set<string>()
  const cleanTail: SessionMessage[] = []
  for (const m of rawTail) {
    if (m.kind === "assistant") {
      const content = (m as { content?: Array<{ type?: string; id?: string }> }).content
      if (Array.isArray(content)) {
        for (const p of content) {
          if (p.type === "tool-call" && p.id) knownCalls.add(p.id)
        }
      }
      cleanTail.push(m)
    } else if (m.kind === "tool") {
      const callId = (m as { callId?: string }).callId
      if (callId && knownCalls.has(callId)) {
        cleanTail.push(m)
      }
    } else {
      cleanTail.push(m)
    }
  }

  // 4. Assemble: system context -> compaction marker -> clean tail
  const messages: SessionMessage[] = [...systemMessages, markerMsg, ...cleanTail]
  return { messages, boundary }
}

/**
 * Microcompact (ZCode `LocalToolResultClear` semantics, projection-native):
 * when the visible history has grown past the compaction trigger, tool
 * results older than the last `keepRecent` are projected as placeholders —
 * the pairing structure (callId) survives, only the bulky output text gives
 * way, and the model can re-run the tool if it truly needs the old value.
 *
 * Implemented as a PURE projection, not a history rewrite: the rule is a
 * deterministic function of the log (visible chars + recency), so every
 * replay derives the same view and the log is never touched — the same
 * "model-visible ⟺ logged" discipline as projectCompacted. Keep the newest
 * `keepRecent` tool results verbatim; gate on `visibleChars` exceeding
 * `thresholdChars` so small sessions never lose anything.
 *
 * Refinements (ZCode's parameter surface): `clearable` restricts clearing to
 * named tools (absent = everything is clearable); error results are KEPT
 * unless `clearErrors` — they are small and the model usually needs them.
 */
export function clearStaleToolResults(messages: SessionMessage[], opts: { keepRecent?: number; thresholdChars: number; visibleChars: number; clearable?: readonly string[]; clearErrors?: boolean }): SessionMessage[] {
  const keep = Math.max(0, opts.keepRecent ?? 12)
  if (keep <= 0 || opts.visibleChars <= opts.thresholdChars) return messages
  const toolIdx: number[] = []
  for (let i = 0; i < messages.length; i++) if (messages[i]!.kind === "tool") toolIdx.push(i)
  const staleCount = toolIdx.length - keep
  if (staleCount <= 0) return messages
  const stale = new Set(toolIdx.slice(0, staleCount))
  const clearable = opts.clearable ? new Set(opts.clearable) : undefined
  return messages.map((m, i) => {
    if (m.kind !== "tool" || !stale.has(i)) return m
    const t = m as { name: string; isError?: boolean }
    if (t.isError && !opts.clearErrors) return m
    if (clearable && !clearable.has(t.name)) return m
    const chars = JSON.stringify(m.output ?? "").length
    return { ...m, output: `[tool result cleared: ${t.name}, ${chars} chars — re-run the tool if you need this output again]` }
  })
}
