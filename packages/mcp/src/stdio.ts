import { RpcClient, parseMessage } from "./rpc"
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"

/** Resolve a command name against PATH (Windows honors PATHEXT: npx → npx.cmd). */
function commandExists(name: string): boolean {
  if (name.includes("/") || name.includes("\\") || name.endsWith(".exe") || name.endsWith(".cmd")) {
    return existsSync(name) || existsSync(join(process.cwd(), name))
  }
  const pathVar = process.env.PATH ?? ""
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""]
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return true
    }
  }
  return false
}

/**
 * MCP stdio transport: spawn the server process, speak newline-delimited
 * JSON-RPC 2.0 over its stdin/stdout. Server stderr is forwarded to our
 * stderr prefixed (it is the only debugging surface a broken server gives).
 */
export class StdioTransport {
  private rpc: RpcClient
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined

  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly env: Record<string, string> | undefined,
    timeoutMs: number,
    private readonly label: string,
  ) {
    this.rpc = new RpcClient(timeoutMs)
  }

  async start(): Promise<void> {
    // Fail-fast when the command is not on PATH (e.g. npx on a machine without
    // Node): instead of spawning a phantom process and waiting the full RPC
    // timeout for silence, reject immediately so the caller skips this server.
    if (!commandExists(this.command)) {
      throw new Error(`command "${this.command}" not found on PATH — install it or remove this MCP server`)
    }
    this.proc = Bun.spawn([this.command, ...this.args], {
      env: { ...process.env, ...(this.env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    void this.readLoop(this.proc.stdout)
    void this.drainStderr(this.proc.stderr)
    await this.initialize()
  }

  private async readLoop(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        const msg = parseMessage(line)
        if (msg?.id !== undefined) this.rpc.settle(msg.id, msg)
      }
    }
    // Stream closed: fail everything in flight so callers don't hang.
    this.rpc.drain(`mcp server "${this.label}" closed its stdout`)
  }

  private async drainStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true }).trimEnd()
      if (text) console.error(`[mcp:${this.label}] ${text}`)
    }
  }

  /** initialize handshake + the notifications/initialized ack (spec order). */
  private async initialize(): Promise<void> {
    const { id, promise } = this.rpc.begin()
    this.proc!.stdin.write(this.rpc.frame(id, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "newhorse", version: "0.1.0" },
    }) + "\n")
    await promise
    this.proc!.stdin.write(this.rpc.notification("notifications/initialized") + "\n")
  }

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const { id, promise } = this.rpc.begin()
    this.proc!.stdin.write(this.rpc.frame(id, method, params) + "\n")
    return (await promise) as T
  }

  async close(): Promise<void> {
    this.rpc.drain(`mcp server "${this.label}" is shutting down`)
    if (!this.proc) return
    try {
      this.proc.stdin.end()
    } catch {
      /* already closed */
    }
    this.proc.kill()
    await this.proc.exited
  }
}
