/**
 * App-wide state, two providers:
 *  - AppProvider: settings + session list + workspace identity, refreshed by
 *    the global bus (throttled) and on demand. Also seeds the resident butler
 *    session (fixed name "newhorse") when the workspace has none.
 *  - StreamProvider: the live turn per session (locally-initiated prompt
 *    streams). Owns send/steer/stop semantics: sending while busy STEERS,
 *    stop aborts the stream and posts interrupt.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { updateOwnedTurn } from "./stream-ownership"
import { api, ClientError, streamPrompt } from "../api/client"
import type { ChatImage, PanelInfo, SessionRow, SettingsView } from "../api/types"
import { useBus } from "../api/bus"
import { normWorkspace } from "../lib/workspace"
import { uuid } from "../lib/uuid"
import { deriveAutoTitle, type FileChange } from "../api/fold"

// ---------- app store ----------

interface AppStore {
  settings: SettingsView | null
  sessions: SessionRow[]
  sessionsError: string | null
  sessionsLoading: boolean
  refreshSessions: () => Promise<void>
  refreshSettings: () => Promise<void>
  /** Switch the active provider (+ optional model) via settings.write; refreshes
   *  the effective settings + session list after. */
  switchProvider: (providerId: string, model?: string) => Promise<void>
  /** Effective workspace for list filtering + creation (selection wins). */
  workspace: string
}

const AppCtx = createContext<AppStore | null>(null)

export function useApp(): AppStore {
  const v = useContext(AppCtx)
  if (!v) throw new Error("useApp outside AppProvider")
  return v
}

export function AppProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const butlerSeeded = useRef<Set<string>>(new Set())

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api.settings())
    } catch {
      // settings are non-critical chrome; the page still works without them
    }
  }, [])

  const switchProvider = useCallback(async (providerId: string, model?: string) => {
    // Provider switch is a host settings change (settings.write), never a
    // client-only illusion: PUT the patch then re-read the effective settings.
    await api.putSettings(model ? { activeProviderId: providerId, model } : { activeProviderId: providerId })
    await refreshSettings()
    window.dispatchEvent(new Event("nh-refresh-sessions"))
  }, [refreshSettings])

  const refreshSessions = useCallback(async () => {
    try {
      const rows = await api.sessions()
      setSessions(rows)
      setSessionsError(null)
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : String(err))
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSettings()
    void refreshSessions()
  }, [refreshSessions, refreshSettings])

  const workspace = normWorkspace(settings?.workspace ?? "")

  // Seed the resident butler session once per workspace (fixed name newhorse).
  // Re-read the registry IMMEDIATELY before creating: the sessions state lags
  // the fetch, and a stale empty read used to spawn a second butler per load.
  useEffect(() => {
    if (!settings || butlerSeeded.current.has(workspace)) return
    butlerSeeded.current.add(workspace)
    void (async () => {
      try {
        const rows = await api.sessions()
        if (rows.some((r) => r.role === "butler" && normWorkspace(r.workspace) === workspace)) return
        await api.createSession(undefined, workspace || undefined, true)
        await refreshSessions()
      } catch {
        // a failed seed retries on the next mount; the shell works without it
      }
    })()
  }, [settings, workspace, refreshSessions])

  // Bus-driven refresh: turn lifecycle frames change rows (status/title/tokens).
  useBus((frame) => {
    const t = frame.event.type
    if (t === "result" || t === "done" || t === "error" || t === "step") void refreshSessions()
  })

  // Window event for immediate refresh from stream store
  useEffect(() => {
    const on = (): void => { void refreshSessions() }
    window.addEventListener("nh-refresh-sessions", on)
    return () => window.removeEventListener("nh-refresh-sessions", on)
  }, [refreshSessions])

  const value: AppStore = { settings, sessions, sessionsError, sessionsLoading, refreshSessions, refreshSettings, switchProvider, workspace }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

// ---------- stream store ----------

export type LiveBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; callId: string; name: string; input: unknown; output?: string; isError?: boolean; streaming?: boolean }
  | { kind: "note"; text: string; variant: "steer" | "error" | "info" }

export interface LiveTurn {
  userPrompt: string
  promptId: string
  images?: ChatImage[]
  blocks: LiveBlock[]
  panels: PanelInfo[]
  changes?: FileChange[]
  error?: string
  step: number
  busy: boolean
  startedAt: number
  /** Emotion tag parsed from the reply tail ([mood:xxx] — engine-injected
   *  instruction). Drives the avatar ball once the reply finishes. */
  mood?: string
}

interface StreamStore {
  live: ReadonlyMap<string, LiveTurn>
  /** Resolves false when the prompt failed to send (transport error) — the
   *  transcript already shows the note; the composer uses it to restore the
   *  draft instead of burning it. */
  send: (sessionId: string, text: string, images?: ChatImage[], opts?: { replace?: boolean; promptId?: string }) => Promise<boolean>
  steer: (sessionId: string, text: string) => Promise<void>
  stop: (sessionId: string, startedAt?: number) => Promise<void>
  /** Drop the settled live turn (after the folded log has been refetched). */
  dismiss: (sessionId: string, startedAt?: number) => void
}

const StreamCtx = createContext<StreamStore | null>(null)

export function useStream(): StreamStore {
  const v = useContext(StreamCtx)
  if (!v) throw new Error("useStream outside StreamProvider")
  return v
}

function findLiveToolBlock(blocks: LiveBlock[], callId: string): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!
    if (b.kind === "tool" && b.callId === callId) return i
  }
  return -1
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

/** Emotion tag the engine asks the model to append ([mood:标签] on the last
 *  line): extract it from a text block tail, strip it from display text.
 *  Tolerates a half-arrived tag while streaming (hides the partial tail). */
const MOOD_TAG_RE = /\s*\[mood:(happy|excited|satisfied|down|angry|worried|puzzled|tired|surprised|shy|neutral)\]\s*$/i
const MOOD_TAG_PARTIAL_RE = /\s*\[mood:[a-z]*$/i
function extractMoodTail(text: string): { text: string; mood?: string } {
  const full = text.match(MOOD_TAG_RE)
  if (full) return { text: text.slice(0, full.index), mood: full[1]!.toLowerCase() }
  const partial = text.match(MOOD_TAG_PARTIAL_RE)
  if (partial) return { text: text.slice(0, partial.index) }
  return { text }
}

export function StreamProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [live, setLive] = useState<ReadonlyMap<string, LiveTurn>>(new Map())
  const liveRef = useRef(live)
  liveRef.current = live
  const aborts = useRef(new Map<string, AbortController>())

  const updateTurn = useCallback((id: string, promptId: string, fn: (t: LiveTurn) => LiveTurn) => {
    setLive((prev) => updateOwnedTurn(prev, id, promptId, fn))
  }, [])

  const steer = useCallback(
    async (sessionId: string, text: string) => {
      const promptId = liveRef.current.get(sessionId)?.promptId
      const ctrl = aborts.current.get(sessionId)
      await api.steer(sessionId, text)
      if (promptId && ctrl && !ctrl.signal.aborted && aborts.current.get(sessionId) === ctrl) {
        updateTurn(sessionId, promptId, (t) => ({ ...t, blocks: [...t.blocks, { kind: "note", text, variant: "steer" as const }] }))
      }
    },
    [updateTurn],
  )

  const send = useCallback(
    async (sessionId: string, text: string, images?: ChatImage[], opts?: { replace?: boolean; promptId?: string }) => {
      if (aborts.current.has(sessionId)) {
        if (images?.length) return false
        try {
          await steer(sessionId, text)
          return true
        } catch {
          return false
        }
      }
      // create (updateTurn only patches an existing entry)
      const ctrl = new AbortController()
      const startedAt = Date.now()
      const promptId = opts?.promptId ?? uuid()
      aborts.current.set(sessionId, ctrl)
      setLive((prev) => {
        const next = new Map(prev)
        next.set(sessionId, { userPrompt: text, promptId, images, blocks: [], panels: [], step: 0, busy: true, startedAt })
        return next
      })

      // Auto-title on prompt: derive clean semantic topic and persist (only on unnamed sessions)
      void (async () => {
        try {
          const rows = await api.sessions()
          const cur = rows.find((r) => r.sessionId === sessionId)
          if (cur && (!cur.title || cur.title.startsWith("未命名") || cur.title === "未命名会话")) {
            const autoTitle = deriveAutoTitle(text)
            if (autoTitle && autoTitle !== cur.title) {
              await api.setTitle(sessionId, autoTitle)
              window.dispatchEvent(new Event("nh-refresh-sessions"))
            }
          }
        } catch {}
      })()

      const apply = (ev: import("../api/client").StreamEvent): void => {
        if (ctrl.signal.aborted || aborts.current.get(sessionId) !== ctrl) return
        updateTurn(sessionId, promptId, (t) => {
          if (ctrl.signal.aborted) return t
          const blocks = [...t.blocks]
          const last = blocks[blocks.length - 1]
          switch (ev.type) {
            case "text": {
              const joined = last?.kind === "text" ? last.text + ev.text : ev.text
              const { text, mood } = extractMoodTail(joined)
              if (last?.kind === "text") blocks[blocks.length - 1] = { kind: "text", text }
              else blocks.push({ kind: "text", text })
              return mood ? { ...t, blocks, mood } : { ...t, blocks }
            }
            case "reasoning":
              if (last?.kind === "thinking") blocks[blocks.length - 1] = { kind: "thinking", text: last.text + ev.text }
              else blocks.push({ kind: "thinking", text: ev.text })
              return { ...t, blocks }
            case "tool":
              blocks.push({ kind: "tool", callId: ev.callId, name: ev.name, input: ev.input })
              return { ...t, blocks }
            case "tool-progress": {
              // Live partial output from a running tool (bash streams stdout).
              // Prefer the block already mid-stream, else the newest pending
              // one; the tail is capped so a firehose command cannot balloon.
              const i = findLiveToolBlock(blocks, ev.callId)
              if (i >= 0) {
                const b = blocks[i] as LiveBlock & { kind: "tool" }
                const next = (b.output ?? "") + ev.text
                blocks[i] = { ...b, output: next.length > 16_000 ? next.slice(-16_000) : next, streaming: true }
              }
              return { ...t, blocks }
            }
            case "tool-result": {
              const i = findLiveToolBlock(blocks, ev.callId)
              if (i >= 0) {
                const b = blocks[i] as LiveBlock & { kind: "tool" }
                blocks[i] = { ...b, output: outputText(ev.output), streaming: false, ...(ev.isError ? { isError: true } : {}) }
              }
              return { ...t, blocks }
            }
            case "panel":
              return {
                ...t,
                panels: [...t.panels, { panelId: ev.panelId, kind: ev.kind, ...(ev.title ? { title: ev.title } : {}), payload: ev.payload }],
              }
            case "step":
              return { ...t, step: ev.step }
            case "error":
              blocks.push({ kind: "note", text: `${ev.code}: ${ev.message}`, variant: "error" })
              return { ...t, error: `${ev.code}: ${ev.message}`, blocks }
            default:
              return t
          }
        })
      }

      try {
        await streamPrompt(sessionId, text, { signal: ctrl.signal, onEvent: apply }, images, { promptId, ...(opts?.replace ? { replace: true } : {}) })
      } catch (err) {
        if (!ctrl.signal.aborted && aborts.current.get(sessionId) === ctrl) {
          const msg = err instanceof Error ? err.message : String(err)
          updateTurn(sessionId, promptId, (t) => ({ ...t, error: msg, blocks: [...t.blocks, { kind: "note", text: msg, variant: "error" as const }] }))
          // Only explicit client rejection establishes that the draft is safe
          // to restore. EOF/network/5xx can follow durable admission.
          return !(err instanceof ClientError && err.status >= 400 && err.status < 500)
        }
      } finally {
        if (aborts.current.get(sessionId) === ctrl) aborts.current.delete(sessionId)
        updateTurn(sessionId, promptId, (t) => ({ ...t, busy: false }))
      }
      return true
    },
    [steer, updateTurn],
  )

  const stop = useCallback(
    async (sessionId: string, startedAt?: number) => {
      const currentTurn = liveRef.current.get(sessionId)
      if (!currentTurn?.busy || (startedAt !== undefined && currentTurn.startedAt !== startedAt)) return
      const ctrl = aborts.current.get(sessionId)
      if (!ctrl) return
      aborts.current.delete(sessionId)
      ctrl.abort()
      updateTurn(sessionId, currentTurn.promptId, (t) => ({ ...t, busy: false }))
      try {
        await api.interrupt(sessionId)
      } catch {
        // the abort already closed the stream; interrupt is belt-and-braces
      }
    },
    [],
  )

  const dismiss = useCallback((sessionId: string, startedAt?: number) => {
    setLive((prev) => {
      const cur = prev.get(sessionId)
      if (!cur || cur.busy) return prev
      if (startedAt !== undefined && cur.startedAt !== startedAt) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
  }, [])

  const value: StreamStore = { live, send, steer, stop, dismiss }
  return <StreamCtx.Provider value={value}>{children}</StreamCtx.Provider>
}
