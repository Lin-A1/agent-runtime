import { createServer } from "./server"
import type { SessionCreateRequest } from "./server"
import { createApp, loadRuntimeSettings, createSqliteSessionDirectory, createApprovalHub, createScheduler, createDagRunner, writeAgentHomeConfig, createMcpManageTool, type Schedule, type App } from "@newhorse/runtime"
import type { Tool } from "@newhorse/core"
import { createMcpTools } from "@newhorse/mcp"
import { MemoryMemoryStore, SqliteMemoryStore, createEmbeddingProvider } from "@newhorse/memory"
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Packaged binary fallback: when NEWHORSE_UI_DIR is unset and a `ui/` folder
 * (built web client) sits next to the executable, serve it — one origin for
 * API + UI without the operator wiring an env var. Returns undefined when
 * nothing is there.
 */
function lookupPackagedUi(): string | undefined {
  if (process.execPath.endsWith("bun.exe") || process.execPath.endsWith("bun")) return undefined // dev: never guess
  const dir = join(process.execPath, "..", "ui")
  return existsSync(join(dir, "index.html")) ? dir : undefined
}

/**
 * Standalone runtime-server entrypoint: `bun run packages/server/src/main.ts`
 *
 * The whole runtime is configured by ENV (see ../config.ts ENV table) — no
 * code required to embed it. Every env read goes through the single
 * authoritative config module, so this entrypoint and the CLI never drift.
 * A HOST embedding the runtime redirects the engine home via AGENT_RUNTIME_HOME.
 *
 * Client wiring (three surfaces, one artifact): NEWHORSE_UI_DIR (or a packaged
 * `ui/` next to this file) serves the built web client on the same origin;
 * the settings page persists into the agent-home config file; the approval
 * hub parks engine gates for the client to settle; the scheduler drives
 * scheduled prompts (定时任务).
 */
let settings = loadRuntimeSettings({ env: process.env })

// LAN-first + secure-by-default: bind 0.0.0.0 (phone access) but mint a token
// on first boot when none is configured — an open 0.0.0.0 API is never fine.
// The token persists into the agent-home config so the next boot keeps it and
// the phone/desktop client can read it (settings page shows it for the LAN).
if (settings.host !== "127.0.0.1" && settings.host !== "::1" && !settings.token) {
  const minted = `nh-${crypto.randomUUID().replaceAll("-", "").slice(0, 32)}`
  await writeAgentHomeConfig(settings.agentHome, { token: minted })
  // Re-read so this boot ALREADY enforces the token (never a silent open window).
  settings = loadRuntimeSettings({ env: process.env })
  console.log(`  token     : auto-minted ${minted.slice(0, 8)}… (LAN access — see ~/.newhorse/config.json)`)
}

// Memory: a durable SQLite store per dataDir when memory is on; in-memory otherwise.
const memStore = settings.memory.on ? new SqliteMemoryStore(join(settings.dataDir, "memory.db")) : new MemoryMemoryStore()
// Semantic search (switchable): attach once; the settings carry the model tag.
// The vector index mode: auto (sqlite-vec when loadable, else in-memory scan).
if (settings.memory.vector.enabled) {
  const { backfill } = memStore.attachEmbedder(
    createEmbeddingProvider({ kind: "minimax", apiKey: settings.memory.vector.embedding.apiKey, model: settings.memory.vector.embedding.model }),
    settings.memory.vector.embedding.model,
    { vectorMode: settings.memory.vector.mode },
  )
  void backfill().catch(() => {})
}

// Cross-process SessionManager (M4): when NEWHORSE_REGISTRY points at a shared
// SQLite file, this server registers owned sessions there and proxies ops for
// sibling-owned sessions. Unset → single-process routing.
const directory = settings.registry ? createSqliteSessionDirectory(settings.registry) : undefined

// Interactive approvals: the client polls GET /v1/approvals and settles via
// POST /v1/approvals/:id; unanswered requests auto-deny after 2 minutes.
const approvals = createApprovalHub()

// Scheduled prompts (定时任务): persisted under the data dir; delivery is the
// server's admitPrompt (wired after the server exists).
let admit: ((sessionId: string, prompt: string) => Promise<void>) | undefined
const schedules = createScheduler({
  file: join(settings.dataDir, "schedules.json"),
  fire: (s: Schedule) => (admit ? admit(s.sessionId, s.prompt) : Promise.reject(new Error("server not started"))),
})

// DAG orchestration (编排): durable runtime over the dataDir event store;
// provider/model resolve fresh per run so settings changes apply.
const dagRunner = createDagRunner({
  dataDir: settings.dataDir,
  getProvider: () => loadRuntimeSettings({ env: process.env }).provider,
  getDefaultModel: () => loadRuntimeSettings({ env: process.env }).model,
  getWorkspace: () => loadRuntimeSettings({ env: process.env }).workspace,
  enableBash: settings.allowBash,
  memoryStore: settings.memory.on ? memStore : undefined,
  skillsDir: settings.pluginsDir,
})

// MCP client seam (docs/agent-runtime-integrations.md §1): configured servers
// mount once at startup and their tools ride EVERY session via AppConfig.tools
// (additive to builtins/plugins; first same-name wins). Fail-soft per server.
// Reloadable: loadMcpTools() re-resolves from the LIVE config so a PUT settings
// or mcp_manage can swap servers in place (app.refreshTools → next turn).
let mcpResources: { byServer: Record<string, { resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>; error?: string }>; readResource: (server: string, uri: string) => Promise<{ text: string; mimeType?: string }> } | undefined
let mcpDispose: (() => Promise<void>) | undefined
const loadMcpTools = async (): Promise<Tool[]> => {
  const fresh = loadRuntimeSettings({ env: process.env })
  if (!fresh.mcpServers || Object.keys(fresh.mcpServers).length === 0) return []
  const { createMcpTools: cmt } = await import("@newhorse/mcp")
  const loaded = await cmt(fresh.mcpServers)
  mcpDispose = () => loaded.dispose()
  if (loaded.resourcesByServer && Object.keys(loaded.resourcesByServer).length > 0) {
    mcpResources = { byServer: loaded.resourcesByServer as never, readResource: loaded.readResource }
  }
  return loaded.tools
}
let appsRegistry: Map<string, App> | undefined
const hotReloadMcp = async (): Promise<void> => {
  try {
    const explicit = await loadMcpTools()
    if (appsRegistry) for (const app of appsRegistry.values()) app.refreshTools([...explicit, mcpManageTool()])
    console.log(`[mcp] hot-reload: ${explicit.length} mcp tool(s) pushed to ${appsRegistry?.size ?? 0} live session(s)`)
  } catch (e) {
    console.error(`[mcp] hot-reload failed:`, e instanceof Error ? e.message : e)
  }
}
const mcpManageTool = () => createMcpManageTool({
  read: async () => (loadRuntimeSettings({ env: process.env }).mcpServers ?? {}) as Record<string, unknown>,
  write: async (mcpServers) => {
    await writeAgentHomeConfig(settings.agentHome, { mcpServers: mcpServers as never })
    await hotReloadMcp()
  },
})
const mcp = settings.mcpServers && Object.keys(settings.mcpServers).length > 0 ? await loadMcpTools() : undefined
if (mcp?.length) console.log(`  mcp       : ${mcp.length} tool(s)`)

// Packaged binary fallback: a `ui/` next to the exe serves the web client
// without an env var (dev runs via bun never guess — execPath is bun).
const uiDir = settings.uiDir ?? lookupPackagedUi()

const handle = await createServer({
  host: settings.host,
  port: settings.port,
  token: settings.token,  // NO static onApprove: the approval hub parks requests for the client and
  // auto-denies unanswered ones after its timeout — fail-closed with a window.
  approvals,
  schedules,
  dagRunner,
  ...(settings.pluginsDir ? { pluginsDir: settings.pluginsDir } : {}),
  agentHome: settings.agentHome,
  ...(settings.channels?.length ? { channels: settings.channels } : {}),
  // MCP tools + an agent-drivable config tool: mcp_manage lets the agent turn
  // any configured MCP server on/off (or change its command/url) without
  // touching the filesystem (the exec policy may chroot the session's fs/bash
  // to the workspace, which would block direct config.json access).
  tools: [...(mcp ?? []), mcpManageTool()],
  // Hot MCP switching: reload the explicit slice from live config and push it
  // to every live app (next prompt sees it — no restart; mcp_manage too).
  loadTools: async () => [...(await loadMcpTools()), mcpManageTool()],
  onApps: (apps) => {
    appsRegistry = apps
  },
  ...(mcpResources && Object.keys(mcpResources.byServer).length > 0 ? { mcpResources } : {}),
  memory: settings.memory.on ? memStore : undefined,
  ...(settings.registry ? { directory, advertiseUrl: settings.advertiseUrl } : {}),
  ...(uiDir ? { uiDir } : {}),
  settings: {
    get: () => loadRuntimeSettings({ env: process.env }),
    write: async (patch) => {
      await writeAgentHomeConfig(settings.agentHome, patch)
      return loadRuntimeSettings({ env: process.env })
    },
  },
  // Per-session config resolves FRESH settings at create time — otherwise a
  // settings-page change would never reach new sessions (the closure would
  // hold the startup snapshot forever).
  sessionConfig: (create: SessionCreateRequest) => {
  const fresh = loadRuntimeSettings({ env: process.env })
  return ({
    // Per-session provider override honored (a host may map workspaces to
    // different providers) — server-level settings are only the default.
    provider: create.provider ?? fresh.provider,
    model: create.model ?? fresh.model,
    asButler: create.asButler === true,
    contextWindowTokens: create.contextWindowTokens ?? fresh.contextWindowTokens,
    maxOutputTokens: create.maxOutputTokens ?? fresh.maxOutputTokens,
    workspace: create.workspace ?? fresh.workspace,
    projectId: create.projectId,
    dataDir: create.dataDir ?? fresh.dataDir,
    agentHome: fresh.agentHome,
    charsPerToken: fresh.charsPerToken,
    enableBash: fresh.allowBash,
    enableWeb: fresh.allowWeb,
    allowPluginCode: fresh.allowPluginCode,
    // declare_dag: the butler's DAG submissions ride the same runner as the
    // HTTP /v1/dag routes (progress projects into the declaring session's
    // todos under its workspace).
    dagRunner,
    // Sessions must discover plugin tools/commands/agents too — the
    // server-level pluginsDir only powers the catalog endpoints; without
    // this the skill/command seams exist but no session can consume them.
    ...(fresh.pluginsDir ? { pluginsDir: fresh.pluginsDir } : {}),
    memoryStore: fresh.memory.on ? memStore : undefined,
    memoryExtract: fresh.memory.extraction ? { enabled: true } : undefined,
    ...(fresh.memory.vector.enabled
      ? {
          memoryVector: {
            enabled: true,
            embedding: { kind: fresh.memory.vector.embedding.kind, baseUrl: fresh.memory.vector.embedding.baseUrl, apiKey: fresh.memory.vector.embedding.apiKey, model: fresh.memory.vector.embedding.model },
          },
        }
      : {})
  })
  },
})

// Wire scheduled-prompt delivery to the server's admit path (the scheduler
// was created before the server; delivery now resolves).
admit = handle.admitPrompt

console.log(`newhorse runtime server`)
console.log(`  listening : ${handle.baseUrl}`)
console.log(`  home      : ${settings.agentHome}`)
console.log(`  provider  : ${settings.provider.kind} @ ${settings.provider.baseUrl} (${settings.model})`)
if (settings.contextWindowTokens) console.log(`  context   : ${settings.contextWindowTokens} tokens (compaction scales to the window)`)
if (settings.maxOutputTokens) console.log(`  max out   : ${settings.maxOutputTokens} tokens per reply`)
if (uiDir) console.log(`  ui        : ${uiDir} (served on this origin)`)
console.log(`  dataDir   : ${settings.dataDir}`)
console.log(`  memory    : ${settings.memory.on ? `on${settings.memory.vector.enabled ? " + semantic" : ""}${settings.memory.extraction ? " + extraction" : ""}` : "off"}`)
console.log(`  bash      : ${settings.allowBash ? "on" : "off"}  web: ${settings.allowWeb ? "on" : "off"}  plugin code: ${settings.allowPluginCode ? "trusted" : "off"}`)
console.log(`  token     : ${settings.token ? "required" : "loopback-only"}`)

// MCP transports own child processes/sockets — close them on shutdown.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void (mcpDispose ? mcpDispose() : Promise.resolve()).finally(() => process.exit(0))
  })
}
void createApp
