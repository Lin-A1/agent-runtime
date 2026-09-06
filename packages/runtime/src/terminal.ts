import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import type { Tool, ToolCtx } from "@newhorse/core"
import { approve, denied } from "./tools/common"

/**
 * Shared workbench terminal (the human-machine co-operation seam).
 *
 * ONE persistent, workspace-scoped shell per session. The human (web terminal)
 * and the agent (`terminal_send` / `terminal_read` tools) drive the SAME shell
 * instance: either side's input lands in the same stdin, and the combined
 * output stream is incrementally readable by both sides — what one party runs,
 * the other sees.
 *
 * Sentinel protocol is borrowed from dsh-workbench's terminal sessions
 * (G:/Code/Agents/Custom/dsh-hub/plugins/workspace/dsh-workbench, pipe mode):
 * every command appends an `echo __NH_DONE_<token>:$?` boundary line, the
 * writer waits for the token to parse its exit code, and sentinel lines are
 * stripped from the shared display stream. Interactive input (raw bytes, e.g.
 * ^C) passes through unwrapped.
 */

const DONE_MARK = "__NH_DONE_"
const MAX_BUFFER_CHARS = 200_000
const MAX_ACTIVITY = 60

export interface TerminalActivityEntry {
  readonly source: "human" | "agent"
  readonly text: string
  readonly ts: number
}

export interface TerminalRead {
  /** New total length after this read — pass back as `since`. */
  readonly cursor: number
  /** Output appended since `since`, sentinel lines stripped. */
  readonly text: string
  readonly alive: boolean
}

interface PendingCommand {
  readonly token: string
  readonly resolve: (result: { output: string; exitCode: number }) => void
  readonly reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function createDoneToken(seq: number): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `DONE_${seq}_${rand}`
}

/**
 * Locate a real Git Bash on Windows (not the WSL/Store stubs that also answer
 * to `bash`) — probe logic borrowed from dsh-workbench's local shell factory.
 * undefined = fall back to ComSpec.
 */
function findWindowsBash(): string | undefined {
  const statics = [
    process.env.NEWHORSE_GIT_BASH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    `${process.env.ProgramFiles || "C:\\Program Files"}\\Git\\bin\\bash.exe`,
    `${process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"}\\Git\\bin\\bash.exe`,
    `${process.env.LocalAppData || ""}\\Programs\\Git\\bin\\bash.exe`,
  ].filter((p): p is string => Boolean(p))
  const found = statics.find((p) => existsSync(p))
  if (found) return found
  try {
    const { stdout } = spawnSync("where.exe", ["bash"], { encoding: "utf8", timeout: 3000 })
    const onPath = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    return onPath.find((p) => !/WindowsApps|System32/i.test(p) && existsSync(p))
  } catch {
    return undefined
  }
}

function shellCommand(): { cmd: string; args: string[] } {
  if (process.platform === "win32") {
    const bash = findWindowsBash()
    if (bash) return { cmd: bash, args: ["--noprofile", "--norc", "-i"] }
    return { cmd: process.env.ComSpec ?? "cmd", args: [] }
  }
  const bash = process.env.SHELL && !process.env.SHELL.endsWith("/sh") ? process.env.SHELL : "bash"
  return { cmd: bash, args: ["--noprofile", "--norc", "-i"] }
}

/** Strip sentinel boundary lines from a display chunk (bash echoes input). */
function stripSentinelLines(text: string): string {
  if (!text.includes(DONE_MARK)) return text
  return text
    .split("\n")
    .filter((line) => !line.includes(DONE_MARK))
    .join("\n")
}

/** One shared shell for one session. Not thread-safe beyond a process — fine:
 *  the app owns it. */
export class TerminalSession {
  #child: ChildProcess | null = null
  #buffer = ""
  #pending = new Map<string, PendingCommand>()
  #activity: TerminalActivityEntry[] = []
  #seq = 0
  #exiting = false

  constructor(readonly cwd: string) {}

  get alive(): boolean {
    return this.#child !== null && !this.#exiting && this.#child.exitCode === null && this.#child.killed === false
  }

  activity(): TerminalActivityEntry[] {
    return [...this.#activity]
  }

  #note(source: "human" | "agent", text: string): void {
    this.#activity = [...this.#activity, { source, text, ts: Date.now() }].slice(-MAX_ACTIVITY)
  }

  #spawn(): ChildProcess {
    // The session's workspace may not exist (e.g. a project created from a bare
    // name before the mkdir-on-create fix). A nonexistent cwd makes spawn fail
    // with ENOENT and every keystroke would be silently dropped — fall back to
    // the process cwd and SAY SO in the shared stream instead.
    let cwd = this.cwd
    if (!existsSync(cwd)) {
      cwd = process.cwd()
      this.#ingest(`[工作区 "${this.cwd}" 不存在 — 终端已回退到 "${cwd}"。请在会话设置中修正工作区路径。]\n`)
    }
    const { cmd, args } = shellCommand()
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    child.stdout?.on("data", (chunk: Buffer) => this.#ingest(chunk.toString("utf8")))
    child.stderr?.on("data", (chunk: Buffer) => this.#ingest(chunk.toString("utf8")))
    child.on("error", () => {
      this.#exiting = false
      this.#child = null
    })
    child.on("close", () => {
      // Fail every waiter honestly; the next write respawns a fresh shell.
      for (const [, p] of this.#pending) {
        clearTimeout(p.timer)
        p.reject(new Error("terminal shell exited"))
      }
      this.#pending.clear()
      this.#child = null
    })
    this.#child = child
    return child
  }

  #ensure(): ChildProcess {
    if (this.alive) return this.#child!
    return this.#spawn()
  }

  #ingest(text: string): void {
    this.#buffer += text
    if (this.#buffer.length > MAX_BUFFER_CHARS) this.#buffer = this.#buffer.slice(-MAX_BUFFER_CHARS)
    // Resolve any pending command whose sentinel has appeared.
    for (const [token, pending] of this.#pending) {
      const re = new RegExp(`${DONE_MARK}${token}:(-?\\d+)`)
      const match = re.exec(this.#buffer)
      if (!match) continue
      clearTimeout(pending.timer)
      this.#pending.delete(token)
      const output = stripSentinelLines(this.#buffer)
      pending.resolve({ output, exitCode: Number(match[1]) })
    }
  }

  /** Human path: a full command line (enter key). Not awaited — the human
   *  watches the shared stream. */
  humanSend(command: string): void {
    this.#note("human", command)
    const child = this.#ensure()
    child.stdin?.write(`${command}\n`)
  }

  /** Human path: raw keystrokes (interactive input, ^C, ql help REPLs). */
  humanWrite(text: string): void {
    if (!text) return
    this.#ensure().stdin?.write(text)
  }

  /** Agent path: run a command to completion (sentinel boundary) and return
   *  its output + exit code. The agent waits; the human watches it stream. */
  agentSend(command: string, timeoutMs = 120_000): Promise<{ output: string; exitCode: number }> {
    this.#note("agent", command)
    const child = this.#ensure()
    const token = createDoneToken(++this.#seq)
    const isWinBash = process.platform !== "win32" || Boolean(findWindowsBash())
    const sentinelLine = process.platform === "win32" && !isWinBash
      ? `echo ${DONE_MARK}${token}:%errorlevel%`
      : `echo "${DONE_MARK}${token}:$?"`
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = {
        token,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending.delete(token)
          reject(new Error(`terminal command timed out after ${timeoutMs}ms`))
        }, timeoutMs),
      }
      this.#pending.set(token, pending)
      child.stdin?.write(`${command}\n${sentinelLine}\n`)
    })
  }

  /** Incremental read for both parties. */
  read(since: number): TerminalRead {
    const from = Math.max(0, Math.min(since, this.#buffer.length))
    return { cursor: this.#buffer.length, text: stripSentinelLines(this.#buffer.slice(from)), alive: this.alive }
  }

  /** Kill the shell (session delete). */
  dispose(): void {
    this.#exiting = true
    this.#child?.kill()
    this.#child = null
  }
}

/** Per-app registry of shared terminals. */
export class TerminalManager {
  readonly #sessions = new Map<string, TerminalSession>()

  get(sessionId: string, cwd: string): TerminalSession {
    let t = this.#sessions.get(sessionId)
    if (!t || t.cwd !== cwd) {
      t?.dispose()
      t = new TerminalSession(cwd)
      this.#sessions.set(sessionId, t)
    }
    return t
  }

  dispose(sessionId: string): void {
    this.#sessions.get(sessionId)?.dispose()
    this.#sessions.delete(sessionId)
  }
}

const TERMINAL_OUTPUT_CAP = 20_000

function tail(text: string, max = TERMINAL_OUTPUT_CAP): string {
  return text.length > max ? text.slice(-max) : text
}

/**
 * The agent's half of the shared terminal (the human half is the web terminal
 * view). Registered for EVERY session — not a butler privilege: any session's
 * agent and its human share one shell. `terminal_send` rides the same exec
 * policy gate as bash (an unaudited shell is a bypass, whatever surface it
 * enters through); `terminal_read` is observational.
 */
export function createSharedTerminalTools(terminal: TerminalSession): Tool[] {
  return [
    {
      name: "terminal_send",
      description: `Run a command in the session's SHARED workbench terminal (one persistent shell you and the human both use — your commands and theirs interleave in the same stream, cwd ${terminal.cwd}). Waits for completion and returns output + exit code. The human sees your command in real time; use terminal_read to catch up on output they produced. Args: { command, timeoutMs? } (clamped to 1s-120s, default 120s).`,
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command line to run." },
          timeoutMs: { type: "number", description: "Max wait in ms (1000-120000, default 120000)." },
        },
        required: ["command"],
      },
      execute: async (input: unknown, ctx?: ToolCtx) => {
        const { command, timeoutMs } = (input ?? {}) as { command?: string; timeoutMs?: number }
        if (!command?.trim()) return { error: "command is required" }
        // Same authorization floor as the bash tool: no policy, no shell.
        const policy = ctx?.execPolicy
        if (!policy) return denied("denied by execpolicy: no policy available")
        const decision = policy.decide(command)
        if (decision === "forbid") return denied(`denied by execpolicy: ${command}`)
        if (decision === "prompt") {
          const ok = await approve(policy, { id: crypto.randomUUID(), kind: "command", target: command, decision: "prompt", reason: "shared terminal command" }, ctx)
          if (!ok) return denied(`denied by execpolicy (prompt not approved): ${command}`)
        }
        const timeout = Math.min(120_000, Math.max(1_000, Math.floor(timeoutMs ?? 120_000)))
        try {
          const result = await terminal.agentSend(command, timeout)
          return { command, exitCode: result.exitCode, output: tail(result.output) }
        } catch (e) {
          return { command, error: e instanceof Error ? e.message : String(e) }
        }
      },
    },
    {
      name: "terminal_read",
      sideEffects: false,
      description: "Read the NEW output appended to the session's shared workbench terminal since your last read (pass the returned cursor back as `since`). Use it to follow the human's commands and long-running output you started. Args: { since? }.",
      inputSchema: {
        type: "object",
        properties: { since: { type: "number", description: "Previous cursor (0 = everything retained)." } },
      },
      execute: async (input: unknown) => {
        const { since } = (input ?? {}) as { since?: number }
        const r = terminal.read(Math.max(0, Math.floor(since ?? 0)))
        return { cursor: r.cursor, alive: r.alive, text: tail(r.text) }
      },
    },
  ]
}
