import { spawn, type ChildProcess } from "node:child_process"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolveInWorkspace } from "./path"
import { fail } from "./common"
import type { Tool, ToolCtx } from "@newhorse/core"

/**
 * Minimal LSP client over the bundled TypeScript server (opencode `lsp` tool
 * analog, TS/JS only — tsserver ships inside the `typescript` package every
 * dev checkout already has). Protocol: tsserver's own JSON over stdio —
 * INPUT is line-delimited JSON (tsserver 5.9 reads stdin via readline, one
 * message per line; Content-Length framing on input is rejected as a JSON
 * parse error), OUTPUT is Content-Length framed. Commands are sent as
 * {seq,type,command} (NOT the LSP initialize handshake).
 *
 * One lazily-spawned server per workspace, reused across calls. ops:
 * hover (quickinfo) / definition / references / documentSymbol (navtree) /
 * workspaceSymbol (navto). File arguments are sandboxed to the workspace.
 */

interface TsResponse {
  seq: number
  type: string
  command?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: unknown
}

class TsServer {
  private child: ChildProcess | undefined
  private buffer = ""
  private nextSeq = 1
  private pending = new Map<number, { resolve: (r: TsResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private opened = new Set<string>()
  private starting: Promise<void> | undefined

  constructor(private readonly tsserverPath: string, private readonly cwd: string) {}

  private async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return
    this.starting ??= this.spawnServer().finally(() => {
      this.starting = undefined
    })
    await this.starting
  }

  private async spawnServer(): Promise<void> {
    const child = spawn("bun", [this.tsserverPath, "--useInferredProjectPerProjectRoot"], { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    child.stdout!.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")))
    child.on("error", (e) => this.failAll(e))
    child.on("close", () => this.failAll(new Error("tsserver exited")))
    // tsserver prints an initial event stream; no handshake needed.
  }

  private failAll(e: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(e)
    }
    this.pending.clear()
    this.child = undefined
    this.opened.clear()
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd)
      const m = /Content-Length: (\d+)/i.exec(header)
      if (!m) {
        this.buffer = ""
        return
      }
      const len = Number(m[1])
      const start = headerEnd + 4
      if (this.buffer.length < start + len) return
      const payload = this.buffer.slice(start, start + len)
      this.buffer = this.buffer.slice(start + len)
      try {
        const msg = JSON.parse(payload) as TsResponse
        if (msg.type === "response" && typeof msg.request_seq === "number") {
          const p = this.pending.get(msg.request_seq)
          if (p) {
            this.pending.delete(msg.request_seq)
            clearTimeout(p.timer)
            p.resolve(msg)
          }
        }
      } catch {
        // partial/garbage frame — drop it
      }
    }
  }

  /** tsserver 5.9 reads stdin line-delimited (readline, one JSON message per
   *  line); only its output is Content-Length framed. */
  private send(command: string, args: Record<string, unknown>): number {
    const seq = this.nextSeq++
    this.child!.stdin!.write(JSON.stringify({ seq, type: "request", command, arguments: args }) + "\n")
    return seq
  }

  private async request(command: string, args: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
    await this.ensureStarted()
    const seq = this.send(command, args)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`tsserver timeout on ${command}`))
      }, timeoutMs)
      this.pending.set(seq, {
        timer,
        resolve: (r) => (r.success === false ? reject(new Error(r.message ?? `${command} failed`)) : resolve(r.body)),
        reject,
      })
    })
  }

  /** Fire-and-forget command: tsserver treats `open`/`close`/`change` as
   *  notifications and never sends a response — awaiting one hangs 15s. */
  private notify(command: string, args: Record<string, unknown>): void {
    this.send(command, args)
  }

  private async openFile(abs: string): Promise<void> {
    if (this.opened.has(abs)) return
    const content = await readFile(abs, "utf8")
    this.notify("open", { file: abs, fileContent: content })
    this.opened.add(abs)
  }

  async call(command: string, abs: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureStarted()
    await this.openFile(abs)
    return this.request(command, { file: abs, ...args })
  }

  /** File-less command (navto / project-wide queries). */
  async raw(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.request(command, args)
  }
}

let client: TsServer | undefined

function resolveTsserver(): string {
  // The engine's own typescript (workspace devDep, hoisted) — never the user's.
  // Bun's resolveSync may return a plain path or a file:// URL depending on version.
  const resolved = import.meta.resolveSync("typescript/lib/tsserver.js")
  return resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved
}

function getClient(workspace: string): TsServer {
  client ??= new TsServer(resolveTsserver(), workspace)
  return client
}

interface Span {
  file?: string
  start?: { line: number; offset: number }
  end?: { line: number; offset: number }
}

const fmtSpan = (s: Span): string => `${s.file ?? "?"}:${s.start?.line ?? "?"}:${s.start?.offset ?? "?"}`

export function createLspTool(workspace: string): Tool {
  return {
    name: "lsp",
    sideEffects: false,
    description: `TypeScript/JavaScript code intelligence via the bundled language server. Args: { op: "hover"|"definition"|"references"|"documentSymbol"|"workspaceSymbol", path?: file under workspace, line?, character?, query? }. hover/definition/references need path+line+character (1-based); documentSymbol needs path; workspaceSymbol needs query. First call per session starts tsserver (a few seconds).`,
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", description: "hover | definition | references | documentSymbol | workspaceSymbol" },
        path: { type: "string", description: "File path (relative to workspace root) — required except for workspaceSymbol." },
        line: { type: "number", description: "1-based line." },
        character: { type: "number", description: "1-based character offset in the line." },
        query: { type: "string", description: "Symbol name for workspaceSymbol." },
      },
      required: ["op"],
    },
    execute: async (input: unknown, _ctx?: ToolCtx) => {
      const { op, path, line, character, query } = (input ?? {}) as { op?: string; path?: string; line?: number; character?: number; query?: string }
      if (!op) return fail("op is required")
      try {
        const server = getClient(workspace)
        if (op === "workspaceSymbol") {
          if (!query) return fail("workspaceSymbol needs query")
          const body = (await server.raw("navto", { searchValue: query, maxResultCount: 50 })) as Span[] | undefined
          return { results: (body ?? []).slice(0, 50).map((s) => ({ location: fmtSpan(s), name: (s as { name?: string }).name, kind: (s as { kind?: string }).kind })) }
        }
        if (!path) return fail(`${op} needs path`)
        const abs = await resolveInWorkspace(workspace, path)
        if (op === "documentSymbol") {
          const body = (await server.call("navtree", abs)) as { childItems?: unknown[] } | undefined
          const flat: Array<{ name: string; kind: string; location: string }> = []
          const walk = (items: unknown[]): void => {
            for (const it of items) {
              const node = it as { text?: string; kind?: string; spans?: Span[]; childItems?: unknown[] }
              if (node.text && node.kind !== "unknown") {
                const span = node.spans?.[0]
                if (span) flat.push({ name: node.text, kind: node.kind ?? "?", location: fmtSpan({ ...span, file: abs }) })
              }
              if (node.childItems) walk(node.childItems)
            }
          }
          if (body?.childItems) walk(body.childItems)
          return { symbols: flat.slice(0, 100) }
        }
        if (typeof line !== "number" || typeof character !== "number") return fail(`${op} needs line and character (1-based)`)
        if (op === "hover") {
          const body = (await server.call("quickinfo", abs, { line, offset: character })) as { displayString?: string; documentation?: string } | undefined
          return { hover: body?.displayString ?? "", documentation: body?.documentation ?? "" }
        }
        if (op === "definition") {
          const body = (await server.call("definition", abs, { line, offset: character })) as Span[] | undefined
          return { locations: (body ?? []).slice(0, 20).map(fmtSpan) }
        }
        if (op === "references") {
          const body = (await server.call("references", abs, { line, offset: character })) as { refs?: Array<Span & { lineText?: string }> } | undefined
          return { references: (body?.refs ?? []).slice(0, 50).map((r) => ({ location: fmtSpan(r), preview: (r.lineText ?? "").trim().slice(0, 120) })) }
        }
        return fail(`unknown op: ${op}`)
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    },
  }
}
