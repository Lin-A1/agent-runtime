import { api } from "../api/client"
import { readHistory, sessionKey, TERMINAL_LIMIT, write } from "./storage"

/**
 * Shared workbench terminal controller — polls the session's ONE persistent
 * shell (the same instance the agent's terminal_send/terminal_read tools drive)
 * and pushes human input into it. Both parties' commands land in the same
 * stream; the activity ledger says who ran what.
 */

export interface TerminalActivity {
  source: "human" | "agent"
  text: string
  ts: number
}

export interface TerminalSnapshot {
  /** Combined shell output (sentinel lines stripped server-side). */
  text: string
  cursor: number
  alive: boolean
  activity: TerminalActivity[]
  history: string[]
  writing: boolean
  error: string | null
  connected: boolean
}

class TerminalController {
  private snapshot: TerminalSnapshot
  private readonly listeners = new Set<() => void>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollSeq = 0

  constructor(private readonly sessionId: string) {
    this.snapshot = { text: "", cursor: 0, alive: false, activity: [], history: readHistory(sessionId), writing: false, error: null, connected: false }
  }

  getSnapshot = (): TerminalSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  private update(patch: Partial<TerminalSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    write(sessionKey(this.sessionId, "history"), this.snapshot.history.slice(-TERMINAL_LIMIT))
    for (const listener of this.listeners) listener()
  }

  start(): void {
    if (this.pollTimer) return
    void this.poll()
    this.pollTimer = setInterval(() => void this.poll(), 900)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async poll(): Promise<void> {
    const seq = ++this.pollSeq
    try {
      const r = await api.terminalRead(this.sessionId, this.snapshot.cursor)
      if (seq !== this.pollSeq) return // superseded / controller switched
      this.update({
        text: (this.snapshot.text + r.text).slice(-120_000),
        cursor: r.cursor,
        alive: r.alive,
        activity: r.activity,
        connected: true,
        error: null,
      })
    } catch (err) {
      if (seq !== this.pollSeq) return
      this.update({ connected: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  async sendCommand(command: string): Promise<void> {
    const cmd = command.trim()
    if (!cmd || this.snapshot.writing) return
    this.update({ writing: true, error: null, history: [...this.snapshot.history.filter((h) => h !== cmd), cmd].slice(-TERMINAL_LIMIT) })
    try {
      await api.terminalWrite(this.sessionId, cmd, "command")
    } catch (err) {
      this.update({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.update({ writing: false })
      void this.poll()
    }
  }

  async sendRaw(text: string): Promise<void> {
    try {
      await api.terminalWrite(this.sessionId, text, "raw")
      void this.poll()
    } catch (err) {
      this.update({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Clear the LOCAL view only (the shared stream keeps flowing). */
  clearView(): void {
    this.update({ text: "", cursor: this.snapshot.cursor })
  }
}

const controllers = new Map<string, TerminalController>()

export function terminalController(sessionId: string): TerminalController {
  const existing = controllers.get(sessionId)
  if (existing) return existing
  const created = new TerminalController(sessionId)
  controllers.set(sessionId, created)
  return created
}
