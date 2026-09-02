/**
 * Global event bus — ONE SSE connection to GET /v1/events/stream feeding
 * every locally-attached session's LoopEvents (opencode's /api/event pump:
 * fixed 250ms reconnect, generation counter kills stale loops, single error
 * log per outage). Components subscribe via onBusFrame / useBus and refresh
 * their slices; this replaces list polling wherever a push channel exists.
 */
import { useEffect, useRef } from "react"
import { baseUrl, token, type StreamEvent } from "./client"

export type BusFrame = { sessionId: string; event: StreamEvent }

type BusListener = (frame: BusFrame) => void

const listeners = new Set<BusListener>()
/** Session ids with activity in the last connectGeneration — reserved for
 *  future coalescing; kept simple today: forward every frame as it lands. */
let started = false
let generation = 0
let errorLogged = false

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function pumpLoop(): Promise<void> {
  let gen = ++generation
  while (gen === generation) {
    try {
      const headers: Record<string, string> = { accept: "text/event-stream" }
      const t = token()
      if (t) headers.authorization = `Bearer ${t}`
      const res = await fetch(`${baseUrl()}/v1/events/stream`, { headers })
      // A 4xx means the server answered (e.g. bad/expired token) — reconnecting
      // would spin forever, so stop the pump; the UI keeps working pull-only.
      if (!res.ok && res.status >= 400 && res.status < 500) {
        console.error(`[bus] stream rejected with HTTP ${res.status} — not reconnecting (check token)`)
        return
      }
      if (!res.ok || !res.body) throw new Error(`bus HTTP ${res.status}`)
      errorLogged = false
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        if (gen !== generation) return
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
        let blockEnd: number
        while ((blockEnd = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, blockEnd)
          buffer = buffer.slice(blockEnd + 2)
          const data = block
            .split("\n")
            .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
            .join("\n")
          if (!data) continue
          try {
            const frame = JSON.parse(data) as BusFrame
            for (const l of listeners) {
              try {
                l(frame)
              } catch {
                // a broken subscriber never kills the pump
              }
            }
          } catch {
            // malformed frame — skip
          }
        }
      }
    } catch (err) {
      if (!errorLogged) {
        console.warn("[bus] stream dropped, reconnecting:", err instanceof Error ? err.message : err)
        errorLogged = true
      }
    }
    if (gen !== generation) return
    await sleep(250)
  }
}

/** Idempotent bootstrap — call once at app mount. */
export function startBus(): void {
  if (started) return
  started = true
  void pumpLoop()
}

export function onBusFrame(fn: BusListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** React binding: subscribe while mounted. */
export function useBus(handler: BusListener): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => onBusFrame((f) => ref.current(f)), [])
}

/** Refresh helper: run `cb` (throttled) when a matching frame lands. */
export function useBusRefresh(matches: (frame: BusFrame) => boolean, cb: () => void, throttleMs = 1_000): void {
  const lastRun = useRef(0)
  useBus((frame) => {
    if (!matches(frame)) return
    const now = Date.now()
    if (now - lastRun.current < throttleMs) return
    lastRun.current = now
    cb()
  })
}
