import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { approve, denied, fail } from "./common"
import type { Tool, ToolCtx } from "@newhorse/core"

const MAX_TIMEOUT = 60_000
const MAX_OUTPUT = 60_000
const BG_TAIL = 20_000

/**
 * The Windows command shell, resolved through ComSpec (the authoritative path
 * Windows itself uses for cmd). A bare `spawn("cmd", {shell:false})` relies on
 * PATH lookup that can fail with ENOENT ("uv_spawn 'cmd'") when the host PATH is
 * trimmed (common in service/sandbox launches). ComSpec is always absolute.
 */
const SHELL_CMD = process.platform === "win32"
  ? process.env.ComSpec ?? "cmd"
  : "/bin/sh"

/**
 * Execute a shell command in the workspace. M3.5 §2.2:
 *   - bash is NOT constrained by the fs sandbox — enabling it authorizes this
 *     session to read/write/execute any reachable path with the process user's
 *     permissions. This boundary is explicit, not implied by fs-tool sandboxing.
 *   - The session must opt in explicitly (createBuiltinTools({ enableBash })).
 *   - cwd is pinned to the workspace (the only free soft constraint).
 *   - A model-supplied timeoutMs is clamped to a hard cap.
 *   - A non-zero exitCode is DATA (the model self-corrects), not an error;
 *     `isError` is reserved for infrastructure failures (spawn fail, kill).
 *   - The command is not sanitized — it IS the intent; the trust boundary is the
 *     user's switch (sanitizing would create false safety).
 *
 * Background trio (wave 8, ZCode Bash/BashOutput/KillShell semantics): a
 * command started with runInBackground returns a taskId immediately; its
 * streams accumulate in a session-scoped registry (survives across turns, dies
 * with the process) that bash_output polls and bash_kill terminates. The same
 * execpolicy gate applies — background is a scheduling choice, not an
 * authorization bypass.
 */

interface BackgroundTask {
  readonly command: string
  readonly startedAt: number
  stdout: string
  stderr: string
  done: boolean
  exitCode: number | null
  child: ReturnType<typeof spawn>
}

/** Keep the LAST max chars of a stream (a tail buffer — old noise is exactly
 *  what background polling wants to skip). */
function tailAppend(buf: string, chunk: string, max: number): string {
  return buf.length + chunk.length <= max ? buf + chunk : (buf + chunk).slice(-max)
}

export function createBashTools(workspace: string): Tool[] {
  const background = new Map<string, BackgroundTask>()

  const gate = async (command: string, ctx?: ToolCtx): Promise<unknown> => {
    const policy = ctx?.execPolicy
    if (!policy) return denied("denied by execpolicy: no policy available")
    const decision = policy.decide(command)
    if (decision === "forbid") return denied(`denied by execpolicy: ${command}`)
    if (decision === "prompt") {
      const ok = await approve(policy, { id: randomUUID(), kind: "command", target: command, decision: "prompt", reason: "shell command" }, ctx)
      if (!ok) return denied(`denied by execpolicy (prompt not approved): ${command}`)
    }
    return undefined
  }

  const bash: Tool = {
    name: "bash",
    description: `Execute a shell command. Working directory is the workspace root: ${workspace}. With runInBackground:true the command starts detached and returns a taskId immediately — poll it with bash_output, stop it with bash_kill.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        timeoutMs: { type: "number", description: `Optional timeout in ms (clamped to ${MAX_TIMEOUT}). Ignored for background runs.` },
        runInBackground: { type: "boolean", description: "Start detached and return a taskId instead of waiting (build watchers, servers, long installs)." },
      },
      required: ["command"],
    },
    execute: async (input: unknown, ctx?: ToolCtx) => {
      const { command, timeoutMs, runInBackground } = (input ?? {}) as { command?: string; timeoutMs?: number; runInBackground?: boolean }
      if (!command) return fail("command is required")
      // M4 execpolicy: an unaudited shell command must fail closed. With no
      // injected policy (or a deny-all fallback) this refuses to run rather than
      // executing bare — the model was not authorized to run arbitrary commands.
      const gateResult = await gate(command, ctx)
      if (gateResult) return gateResult

      if (runInBackground) {
        const taskId = randomUUID()
        const child = spawnBackground(command, resolve(workspace), taskId, background)
        return { taskId, command, running: true, note: `poll with bash_output; stop with bash_kill (${taskId.slice(0, 8)})` }
      }

      // Default to the hard cap when the model omits timeoutMs; clamp any
      // supplied value into [1, MAX_TIMEOUT] so a 0/negative/NaN never becomes a
      // 1ms kill-all default.
      const timeout = clamp(Math.floor(timeoutMs ?? MAX_TIMEOUT), 1, MAX_TIMEOUT)
      return run(command, resolve(workspace), timeout, ctx?.signal, ctx?.onProgress)
    },
  }

  const bashOutput: Tool = {
    name: "bash_output",
    sideEffects: false,
    description: "Read a background task's accumulated output. Args: { taskId }. Returns running state, exit code (when settled), and the stdout/stderr tails.",
    execute: async (input: unknown) => {
      const { taskId } = (input ?? {}) as { taskId?: string }
      if (!taskId) return fail("taskId is required")
      const task = background.get(taskId)
      if (!task) return fail(`unknown taskId (${background.size} tracked)`)
      return {
        taskId,
        command: task.command,
        running: !task.done,
        ...(task.done ? { exitCode: task.exitCode } : {}),
        stdout: task.stdout,
        stderr: task.stderr,
      }
    },
  }

  const bashKill: Tool = {
    name: "bash_kill",
    description: "Terminate a background task's whole process tree. Args: { taskId }. A settled task returns killed:false.",
    execute: async (input: unknown) => {
      const { taskId } = (input ?? {}) as { taskId?: string }
      if (!taskId) return fail("taskId is required")
      const task = background.get(taskId)
      if (!task) return fail(`unknown taskId (${background.size} tracked)`)
      if (task.done) return { taskId, killed: false, note: "already settled" }
      killTree(task.child)
      task.done = true
      return { taskId, killed: true }
    },
  }

  const bashInput: Tool = {
    name: "bash_input",
    description: "Write input characters to a running background task's stdin (codex write_stdin analog). Args: { taskId, chars, yield_time_ms? } — sends chars, waits up to yield_time_ms (default 1000, max 5000), returns the latest output delta.",
    execute: async (input: unknown) => {
      const { taskId, chars, yield_time_ms } = (input ?? {}) as { taskId?: string; chars?: string; yield_time_ms?: number }
      if (!taskId) return fail("taskId is required")
      if (typeof chars !== "string") return fail("chars is required")
      const task = background.get(taskId)
      if (!task) return fail(`unknown taskId (${background.size} tracked)`)
      if (task.done) return fail(`task ${taskId} has already exited (code ${task.exitCode})`)
      if (!task.child.stdin || task.child.stdin.destroyed) return fail("task stdin is closed")
      const prevStdoutLen = task.stdout.length
      const prevStderrLen = task.stderr.length
      try {
        task.child.stdin.write(chars)
      } catch (e) {
        return fail(`stdin write failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      const waitMs = clamp(Math.floor(yield_time_ms ?? 1_000), 100, 5_000)
      await new Promise((r) => setTimeout(r, waitMs))
      return {
        taskId,
        running: !task.done,
        ...(task.done ? { exitCode: task.exitCode } : {}),
        stdout: task.stdout.slice(prevStdoutLen),
        stderr: task.stderr.slice(prevStderrLen),
        accumulatedStdout: task.stdout,
      }
    },
  }

  return [bash, bashOutput, bashKill, bashInput]
}

function spawnBackground(command: string, cwd: string, taskId: string, registry: Map<string, BackgroundTask>): ReturnType<typeof spawn> {
  const shell = process.platform === "win32"
    ? { cmd: SHELL_CMD, args: ["/d", "/s", "/c", command] }
    : { cmd: "/bin/sh", args: ["-c", command] }
  // POSIX: detached + process-group kill so grandchildren (the servers and
  // watchers this feature exists for) die with the shell. Windows uses the
  // taskkill /T tree-kill in killTree. stdin is "pipe" so bash_input can write.
  const child = spawn(shell.cmd, shell.args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"], ...(process.platform === "win32" ? {} : { detached: true }) })
  const task: BackgroundTask = { command, startedAt: Date.now(), stdout: "", stderr: "", done: false, exitCode: null, child }
  registry.set(taskId, task)
  child.stdout?.on("data", (chunk: Buffer) => {
    task.stdout = tailAppend(task.stdout, chunk.toString("utf8"), BG_TAIL)
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    task.stderr = tailAppend(task.stderr, chunk.toString("utf8"), BG_TAIL)
  })
  child.on("close", (code) => {
    task.done = true
    task.exitCode = code
    // Settled-entry cap: each entry holds ~40KB of tails plus a child
    // handle — a long session must not accumulate them forever.
    const settled = [...registry.entries()].filter(([, t]) => t.done)
    if (settled.length > 20) {
      for (const [id] of settled.slice(0, settled.length - 20)) registry.delete(id)
    }
  })
  child.on("error", () => {
    task.done = true
    task.exitCode = -1
    task.stderr = tailAppend(task.stderr, "failed to spawn", BG_TAIL)
  })
  return child
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (child.exitCode !== null) return
  // Windows: taskkill /T /F kills the whole tree (proc.kill() only kills the
  // direct child; grandchildren via cmd /c would become orphans).
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  } else if (child.pid) {
    // Negative pid = the whole process group (requires detached:true).
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n) || n < lo) return lo
  return n > hi ? hi : n
}

async function run(command: string, cwd: string, timeout: number, signal?: AbortSignal, onProgress?: (text: string) => void): Promise<unknown> {
  const shell = process.platform === "win32"
    ? { cmd: SHELL_CMD, args: ["/d", "/s", "/c", command] }
    : { cmd: "/bin/sh", args: ["-c", command] }

  const child = spawn(shell.cmd, shell.args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  let done = false
  let timedOut = false

  // Live progress: stdout+stderr chunks stream to the transport while the
  // command runs (throttled to one frame per PROGRESS_INTERVAL_MS, tail-capped
  // so a firehose command cannot flood the event channel).
  const PROGRESS_INTERVAL_MS = 120
  const PROGRESS_WINDOW = 4_000
  let progressBuf = ""
  let lastFlush = 0
  const flushProgress = (force = false): void => {
    if (!onProgress || !progressBuf) return
    const now = Date.now()
    if (!force && now - lastFlush < PROGRESS_INTERVAL_MS) return
    onProgress(progressBuf)
    progressBuf = ""
    lastFlush = now
  }
  const pushProgress = (chunk: string): void => {
    if (!onProgress) return
    progressBuf = (progressBuf + chunk).slice(-PROGRESS_WINDOW)
    flushProgress()
  }

  const kill = () => killTree(child)

  const onAbort = () => kill()
  signal?.addEventListener("abort", onAbort, { once: true })

  const timer = setTimeout(() => {
    timedOut = true
    kill()
  }, timeout)

  const finish = (code: number | null): Record<string, unknown> => {
    done = true
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
    flushProgress(true)
    const stdoutTrunc = stdout.length > MAX_OUTPUT
    const stderrTrunc = stderr.length > MAX_OUTPUT
    return {
      command,
      exitCode: code,
      stdout: stdout.slice(0, MAX_OUTPUT),
      stderr: stderr.slice(0, MAX_OUTPUT),
      stdoutTruncated: stdoutTrunc,
      stderrTruncated: stderrTrunc,
      timedOut,
    }
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8")
    pushProgress(chunk.toString("utf8"))
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8")
    pushProgress(chunk.toString("utf8"))
  })

  return new Promise<unknown>((resolvePromise) => {
    child.on("close", (code) => resolvePromise(finish(code)))
    child.on("error", (e) => {
      // A spawn failure (e.g. ENOENT) must also release the timeout + abort
      // listener, exactly as `finish` does, so nothing leaks across calls.
      if (!done) {
        done = true
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        resolvePromise(fail(`failed to spawn: ${e.message}`))
      }
    })
  })
}
