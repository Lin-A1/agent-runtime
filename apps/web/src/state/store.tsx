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
import { api, streamPrompt } from "../api/client"
import type { ChatImage, PanelInfo, SessionRow, SettingsView } from "../api/types"
import { useBus } from "../api/bus"
import { normWorkspace } from "../lib/workspace"
import { deriveAutoTitle } from "../api/fold"

// ---------- app store ----------

interface AppStore {
  settings: SettingsView | null
  sessions: SessionRow[]
  sessionsError: string | null
  sessionsLoading: boolean
  refreshSessions: () => Promise<void>
  refreshSettings: () => Promise<void>
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

  const value: AppStore = { settings, sessions, sessionsError, sessionsLoading, refreshSessions, refreshSettings, workspace }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

// ---------- stream store ----------

export type LiveBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; input: unknown; output?: string; isError?: boolean }
  | { kind: "note"; text: string; variant: "steer" | "error" | "info" }

export interface LiveTurn {
  userPrompt: string
  images?: ChatImage[]
  blocks: LiveBlock[]
  panels: PanelInfo[]
  step: number
  busy: boolean
  startedAt: number
}

interface StreamStore {
  live: ReadonlyMap<string, LiveTurn>
  send: (sessionId: string, text: string, images?: ChatImage[]) => Promise<void>
  steer: (sessionId: string, text: string) => Promise<void>
  stop: (sessionId: string) => Promise<void>
  /** Drop the settled live turn (after the folded log has been refetched). */
  dismiss: (sessionId: string, startedAt?: number) => void
}

const StreamCtx = createContext<StreamStore | null>(null)

export function useStream(): StreamStore {
  const v = useContext(StreamCtx)
  if (!v) throw new Error("useStream outside StreamProvider")
  return v
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

export function StreamProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [live, setLive] = useState<ReadonlyMap<string, LiveTurn>>(new Map())
  const liveRef = useRef(live)
  liveRef.current = live
  const aborts = useRef(new Map<string, AbortController>())

  const updateTurn = useCallback((id: string, fn: (t: LiveTurn) => LiveTurn) => {
    setLive((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(id, fn(cur))
      return next
    })
  }, [])

  const steer = useCallback(
    async (sessionId: string, text: string) => {
      await api.steer(sessionId, text)
      updateTurn(sessionId, (t) => ({ ...t, blocks: [...t.blocks, { kind: "note", text, variant: "steer" as const }] }))
    },
    [updateTurn],
  )

  const send = useCallback(
    async (sessionId: string, text: string, images?: ChatImage[]) => {
      if (liveRef.current.get(sessionId)?.busy) {
        await steer(sessionId, text)
        return
      }
      // create (updateTurn only patches an existing entry)
      setLive((prev) => {
        const next = new Map(prev)
        next.set(sessionId, { userPrompt: text, images, blocks: [], panels: [], step: 0, busy: true, startedAt: Date.now() })
        return next
      })
      const ctrl = new AbortController()
      aborts.current.set(sessionId, ctrl)

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
        updateTurn(sessionId, (t) => {
          const blocks = [...t.blocks]
          const last = blocks[blocks.length - 1]
          switch (ev.type) {
            case "text":
              if (last?.kind === "text") blocks[blocks.length - 1] = { kind: "text", text: last.text + ev.text }
              else blocks.push({ kind: "text", text: ev.text })
              return { ...t, blocks }
            case "reasoning":
              if (last?.kind === "thinking") blocks[blocks.length - 1] = { kind: "thinking", text: last.text + ev.text }
              else blocks.push({ kind: "thinking", text: ev.text })
              return { ...t, blocks }
            case "tool":
              blocks.push({ kind: "tool", name: ev.name, input: ev.input })
              return { ...t, blocks }
            case "tool-result": {
              for (let i = blocks.length - 1; i >= 0; i--) {
                const b = blocks[i]
                if (b.kind === "tool" && b.name === ev.name && b.output === undefined) {
                  blocks[i] = { ...b, output: outputText(ev.output), ...(ev.isError ? { isError: true } : {}) }
                  break
                }
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
              return { ...t, blocks }
            default:
              return t
          }
        })
      }

      try {
        await streamPrompt(sessionId, text, { signal: ctrl.signal, onEvent: apply }, images)
      } catch (err) {
        const aborted = ctrl.signal.aborted
        const msg = err instanceof Error ? err.message : String(err)
        updateTurn(sessionId, (t) => ({
          ...t,
          blocks: aborted ? t.blocks : [...t.blocks, { kind: "note", text: msg, variant: "error" as const }],
        }))
      } finally {
        aborts.current.delete(sessionId)
        updateTurn(sessionId, (t) => ({ ...t, busy: false }))
      }
    },
    [steer, updateTurn],
  )

  const stop = useCallback(
    async (sessionId: string) => {
      aborts.current.get(sessionId)?.abort()
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
