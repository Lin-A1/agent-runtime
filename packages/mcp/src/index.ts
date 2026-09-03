import type { Tool } from "@newhorse/core"
import { StdioTransport } from "./stdio"
import { HttpTransport } from "./http"

/**
 * MCP client seam (docs/agent-runtime-integrations.md §1): mount external MCP
 * servers as ordinary `Tool`s. Naming follows the `mcp__<server>__<tool>`
 * convention; the whole surface is conservative (`sideEffects: true`) because
 * a third-party tool's real effects are unknown to us.
 *
 * Fail-soft by design: a server that fails to start contributes ZERO tools
 * and a stderr warning — a broken integration must never block session
 * creation. `dispose()` closes every transport (host shutdown path).
 */

/**
 * Structural guarantee: runtime's McpServerSettings (the config-file mirror)
 * must stay assignable to this richer interface — the host passes its parsed
 * settings straight into createMcpTools. Breakage here is a type error in
 * @newhorse/runtime's settings tests, not a silent drift.
 */
export interface McpServerConfig {
  readonly enabled?: boolean
  /** stdio server: command + args + extra env. */
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Record<string, string>
  /** http server: streamable-HTTP URL + request headers (e.g. Authorization). */
  readonly url?: string
  readonly headers?: Record<string, string>
  /** Optional allowlist of THIS server's tool names (prefix-free, exact). */
  readonly allowedTools?: readonly string[]
  /** Per-server request timeout (default 30000ms). */
  readonly timeoutMs?: number
}

export interface McpToolsResult {
  readonly tools: Tool[]
  readonly dispose: () => Promise<void>
}

export interface McpResourceDef {
  readonly uri: string
  readonly name?: string
  readonly description?: string
  readonly mimeType?: string
}

export interface McpResourceContent {
  readonly uri?: string
  readonly mimeType?: string
  readonly text?: string
}

export interface McpToolsResult {
  readonly tools: Tool[]
  /** server name → its resources + optional error (resources/list is an
   *  OPTIONAL MCP capability: a tools-only server reports "no resources"
   *  with the error recorded, never a mount failure). */
  readonly resourcesByServer: Record<string, { resources: McpResourceDef[]; error?: string }>
  /** Read one resource's text content through the server's LIVE transport. */
  readonly readResource: (server: string, uri: string) => Promise<{ text: string; mimeType?: string }>
  readonly dispose: () => Promise<void>
}

interface McpToolDef {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

interface McpCallResult {
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
  readonly isError?: boolean
}

interface McpTransport {
  readonly start: () => Promise<void>
  readonly request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  readonly close: () => Promise<void>
}

export async function createMcpTools(configs: Record<string, McpServerConfig>, fetchImpl: typeof fetch = fetch): Promise<McpToolsResult> {
  const transports: Array<{ close(): Promise<void> }> = []
  const live = new Map<string, McpTransport>()
  const tools: Tool[] = []
  const resourcesByServer: McpToolsResult["resourcesByServer"] = {}

  for (const [name, cfg] of Object.entries(configs)) {
    if (cfg.enabled === false) continue
    try {
      const transport = cfg.url
        ? new HttpTransport(cfg.url, cfg.headers, fetchImpl, cfg.timeoutMs ?? 30_000, name)
        : cfg.command
          ? new StdioTransport(cfg.command, cfg.args ?? [], cfg.env, cfg.timeoutMs ?? 30_000, name)
          : null
      if (!transport) {
        console.error(`[mcp:${name}] config needs "command" or "url" — skipped`)
        continue
      }
      await transport.start()
      transports.push(transport)
      live.set(name, transport as unknown as McpTransport)
      const allow = cfg.allowedTools ? new Set(cfg.allowedTools) : undefined
      const defs: McpToolDef[] = []
      // Follow pagination: servers with >1 page of tools silently truncate
      // otherwise, and a truncated surface looks like "the tool is missing".
      let cursor: string | undefined
      do {
        const page = await transport.request<{ tools?: McpToolDef[]; nextCursor?: string }>("tools/list", ...(cursor ? [{ cursor } as Record<string, unknown>] : []))
        defs.push(...(page.tools ?? []))
        cursor = page.nextCursor
      } while (cursor)
      for (const def of defs) {
        if (allow && !allow.has(def.name)) continue
        tools.push({
          name: `mcp__${name}__${def.name}`,
          description: def.description,
          inputSchema: def.inputSchema,
          sideEffects: true, // unknown third-party effects — conservative always
          execute: async (input: unknown) => {
            const result = await transport.request<McpCallResult>("tools/call", { name: def.name, ...(input !== undefined ? { arguments: input } : {}) })
            const text = (result.content ?? [])
              .filter((c) => c.type === "text" || c.text !== undefined)
              .map((c) => c.text ?? "")
              .join("\n")
            if (result.isError) throw new Error(text || `mcp tool ${def.name} reported an error`)
            // Prefer the joined text when there is any; an empty content list
            // falls through to the raw result so callers never lose data.
            return text !== "" ? text : result
          },
        })
      }
      // resources/list on the SAME live transport (one spawn per server).
      try {
        const resources: McpResourceDef[] = []
        let rcursor: string | undefined
        do {
          const page = await transport.request<{ resources?: McpResourceDef[]; nextCursor?: string }>("resources/list", ...(rcursor ? [{ cursor: rcursor } as Record<string, unknown>] : []))
          resources.push(...(page.resources ?? []))
          rcursor = page.nextCursor
        } while (rcursor)
        resourcesByServer[name] = { resources }
      } catch (e) {
        resourcesByServer[name] = { resources: [], error: e instanceof Error ? e.message : String(e) }
      }
    } catch (err) {
      // Fail-soft: a dead server is a warning, never a session-creation error.
      console.error(`[mcp:${name}] failed to start or list tools — skipped:`, err instanceof Error ? err.message : err)
    }
  }

  return {
    tools,
    resourcesByServer,
    readResource: async (server, uri) => {
      const transport = live.get(server)
      if (!transport) throw new Error(`unknown or dead mcp server "${server}"`)
      const result = await transport.request<{ contents?: McpResourceContent[] }>("resources/read", { uri })
      const text = (result.contents ?? []).map((c) => c.text ?? "").join("\n")
      const mimeType = (result.contents ?? []).find((c) => c.mimeType)?.mimeType
      return { text, ...(mimeType ? { mimeType } : {}) }
    },
    dispose: async () => {
      for (const t of transports) await t.close().catch(() => {})
    },
  }
}

interface McpToolDef {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

interface McpCallResult {
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
  readonly isError?: boolean
}
