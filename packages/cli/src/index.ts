import { createApp, loadRuntimeSettings, createSqliteSessionDirectory, createDagRunner } from "@newhorse/runtime"
import { SessionRegistry, SqliteEventStore, projectCompacted, clearStaleToolResults, compactLimit } from "@newhorse/core"
import { makeLlmClient, type AdapterConfig } from "@newhorse/llm"
import type { SessionMessage, ApprovalRequest, StoredEvent } from "@newhorse/schema"
import { createInterface } from "node:readline"
import { join, resolve } from "node:path"

/**
 * CLI entrypoint — the engine's official interactive surface (the web shell
 * was retired; see docs/runtime-retrospective.md §6.3).
 *
 * Two modes:
 *   - one-shot: `newhorse "prompt"` / `--prompt` / stdin, or a management
 *     subcommand (sessions / compact / fork / title / policy / context /
 *     archive / dag);
 *   - REPL: no --prompt and a TTY — /steer /todos /goal /fork /compact /title
 *     /policy /context /list /interrupt.
 *
 * Configuration is UNIFIED with the server: provider/model/budgets/dataDir
 * resolve through loadRuntimeSettings (defaults < agent-home config.json < env
 * < cli args), so a provider preset configured for the server works here with
 * zero env vars. One boundary: when a running SERVER has the target session
 * attached (registry-configured setups), the CLI refuses to double-drive it —
 * two Apps must never drive one log.
 */
export async function main(argv: string[]): Promise<void> {
  const { flags, rest } = parseArgs(argv)
  const settings = loadRuntimeSettings({
    env: process.env,
    cli: {
      model: flags.model,
      ...(flags.provider ? { providerKind: flags.provider as ReturnType<typeof loadRuntimeSettings>["provider"]["kind"] } : {}),
      baseUrl: flags["base-url"],
      dataDir: flags["data-dir"],
      workspace: flags.workspace,
      contextWindowTokens: flags["context-window"] ? Number(flags["context-window"]) : undefined,
      maxOutputTokens: flags["max-output"] ? Number(flags["max-output"]) : undefined,
    },
  })
  const directory = settings.registry ? createSqliteSessionDirectory(settings.registry) : undefined

  // Management subcommands (no LLM turn). Each attaches its own App over the
  // configured dataDir — the same SQLite log the server would use. Anything
  // else is a free-text prompt (usage line 1).
  const sub = rest[0]
  const KNOWN = new Set(["sessions", "compact", "fork", "title", "policy", "context", "archive", "dag", "help"])
  if (sub !== undefined && !KNOWN.has(sub)) {
    const app = await buildApp(flags, settings, directory)
    await runPrompt(app, rest.join(" "))
    return
  }
  if (sub) {
    const app = await buildApp(flags, settings, directory)
    switch (sub) {
      case "sessions":
        for (const r of await app.listSessions()) {
          console.log(`${r.sessionId}  [${r.status}]${r.role === "butler" ? " butler" : ""}${r.archived ? " archived" : ""}  ${r.title ?? "(untitled)"}  ${new Date(r.updatedAt).toLocaleString()}`)
        }
        return
      case "compact": {
        const r = await app.compact()
        console.log(`compacted at seq ${r.boundarySeq}; summary: ${r.summary || "(local marker)"}`)
        return
      }
      case "fork": {
        const atSeq = rest[1] !== undefined ? Number(rest[1]) : undefined
        const res = await forkSession(app, atSeq)
        console.log(`forked → ${res.newId} (at seq ${res.atSeq})`)
        return
      }
      case "title": {
        const title = rest.slice(1).join(" ").trim()
        if (!title) throw new Error("title is required: newhorse title <text>")
        await app.events.append(app.sessionId, "Session.TitleSet", { sessionId: app.sessionId, title, ts: Date.now() })
        console.log(`title set: ${title}`)
        return
      }
      case "policy": {
        const level = rest[1]
        if (level !== undefined) {
          if (level !== "strict" && level !== "readonly" && level !== "trusted") throw new Error("policy must be strict | readonly | trusted")
          await app.setPolicy(level)
        }
        console.log(`policy: ${app.policy()}`)
        return
      }
      case "context": {
        const events = (await app.events.read(app.sessionId)) as StoredEvent[]
        const cpt = settings.charsPerToken ?? 2.5
        const limit = compactLimit({ contextWindowTokens: settings.contextWindowTokens, charsPerToken: cpt })
        const { messages: projected } = projectCompacted(events)
        const visible = clearStaleToolResults(projected, { thresholdChars: limit, visibleChars: projected.reduce((n, m) => n + JSON.stringify(m).length, 0) })
        const chars = visible.reduce((n, m) => n + JSON.stringify(m).length, 0)
        const estTokens = Math.ceil(chars / cpt)
        const w = settings.contextWindowTokens
        console.log(`${chars.toLocaleString()} chars ≈ ${estTokens.toLocaleString()} tokens${w ? ` (${Math.min(100, Math.round((estTokens / (w * 0.6)) * 100))}% of the ${(w / 1000) | 0}k window)` : ""}`)
        return
      }
      case "archive": {
        const archived = rest[1] !== "off"
        await app.events.append(app.sessionId, "Session.Archived", { sessionId: app.sessionId, archived, ts: Date.now() })
        console.log(`archived: ${archived}`)
        return
      }
      case "dag": {
        await dagCommand(settings, rest.slice(1), flags)
        return
      }
      case "help":
        printUsage()
        return
      default:
        throw new Error(`unknown subcommand "${sub}" — try "newhorse help"`)
    }
  }

  const app = await buildApp(flags, settings, directory)

  // Interactive REPL when no --prompt was given: Ctrl-C interrupts the current
  // run, /steer / /list / /interrupt / <text> drive the session.
  if (flags.prompt === undefined && !process.env.NEWHORSE_NO_REPL) {
    await repl(app)
    return
  }

  const promptText = flags.prompt ?? (await readStdin())
  if (!promptText) {
    printUsage()
    return
  }
  await runPrompt(app, promptText)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`\u001b[31m${message}\u001b[0m`)
    process.exitCode = 1
  })
}

/** One prompt run with the split-brain guard: when a registry is configured
 *  and a live SERVER owns this session, driving it from the CLI would put two
 *  Apps on one log — refuse with the way out (own --session / stop the server).
 *  A slash line resolves against the plugin seam (never interpreted here). */
async function runPrompt(app: Awaited<ReturnType<typeof buildApp>>, text: string): Promise<void> {
  if (text.startsWith("/")) {
    const output = await app.runCommand(text)
    if (output === undefined) throw new Error(`unknown command: ${text.split(" ")[0]}`)
    console.log(typeof output === "string" ? output : JSON.stringify(output, null, 2))
    return
  }
  await app.prompt(text, "user")
  const history = await app.resume()
  console.log()
  for (const message of history.messages) {
    if (message.kind === "user") printMessage(message)
  }
}

function parseArgs(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {}
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1] ?? "true"
      i++
    } else {
      rest.push(a)
    }
  }
  return { flags, rest }
}

/** Build the App from unified settings. Provider/model/budgets/dataDir come
 *  from loadRuntimeSettings (agent-home presets included); flags override. */
async function buildApp(flags: Record<string, string>, settings: ReturnType<typeof loadRuntimeSettings>, directory: ReturnType<typeof createSqliteSessionDirectory> | undefined): Promise<Awaited<ReturnType<typeof createApp>>> {
  assertNotServerOwned(settings, directory, resolveSessionId(flags, settings))
  const config: AdapterConfig = settings.provider
  return createApp({
    provider: config,
    model: settings.model,
    workspace: settings.workspace,
    sessionId: resolveSessionId(flags, settings),
    dataDir: settings.dataDir,
    contextWindowTokens: settings.contextWindowTokens,
    maxOutputTokens: settings.maxOutputTokens,
    pluginsDir: flags["plugins-dir"] ? resolve(flags["plugins-dir"]) : settings.pluginsDir,
    asButler: flags.butler ? true : false,
    memoryVector: flags["memory-vector"]
      ? {
          enabled: true,
          embedding: {
            kind: (settings.memory.vector.embedding.kind ?? "minimax") as "minimax" | "openai-compatible",
            apiKey: settings.memory.vector.embedding.apiKey,
            model: settings.memory.vector.embedding.model,
            baseUrl: settings.memory.vector.embedding.baseUrl,
          },
        }
      : undefined,
    onApprove: async (req: ApprovalRequest): Promise<boolean> => {
      const label = req.kind === "command" ? "command" : req.kind === "path" ? "path write" : req.kind
      return askUser(`\u001b[33m[execpolicy] ${label}: ${req.target}\u001b[0m allow? (y/N) `)
    },
  })
}

/** A registry row with a fresh heartbeat = a live server owns this session. */
function assertNotServerOwned(settings: ReturnType<typeof loadRuntimeSettings>, directory: ReturnType<typeof createSqliteSessionDirectory> | undefined, sessionId: string | undefined): void {
  if (!directory || !sessionId) return
  const entry = directory.lookup(sessionId)
  if (entry && Date.now() - entry.heartbeatAt < 30_000) {
    throw new Error(`session "${sessionId}" is driven by ${entry.endpoint} — attach a different one via --session <id>, or stop that server first`)
  }
}

function printUsage(): void {
  console.log(`usage:
  newhorse "prompt"                  one prompt into the workspace session
  newhorse                           interactive REPL
  newhorse sessions                  list sessions in the data dir
  newhorse compact                   fold the session head now
  newhorse fork [atSeq]              fork at a user-turn boundary
  newhorse title <text>              rename the session
  newhorse policy [strict|readonly|trusted]   read / set the policy level
  newhorse context                   visible context vs the window
  newhorse archive [off]             archive / unarchive the session
  newhorse dag [--file spec.json | <dagId>]   run / list / status
  flags: --model --provider --base-url --session --data-dir --workspace --butler --plugins-dir --memory-vector`)
}

// --- dag ---

/** DAG surface: `--file spec.json` runs durably (SqliteEventStore — resumable
 *  and status-able, unlike the old in-memory run); bare `dag` lists; `dag <id>`
 *  prints one status. Abort stays server-side: a CLI process holds no live
 *  controllers after exit, so a cross-process abort would be a fake affordance. */
async function dagCommand(settings: ReturnType<typeof loadRuntimeSettings>, rest: string[], flags: Record<string, string>): Promise<void> {
  if (flags.file) {
    const events = SqliteEventStore.open(join(settings.dataDir, "events.db"))
    const { MemorySessionInput } = await import("@newhorse/core")
    const inbox = new MemorySessionInput(events)
    const spec = JSON.parse(await (await import("node:fs/promises")).readFile(resolve(flags.file), "utf8")) as import("@newhorse/core").DAGSpec
    const tools = (await import("@newhorse/runtime")).createBuiltinTools({ workspace: settings.workspace, events, enableBash: settings.allowBash })
    const runtime = { events, inbox, llm: makeLlmClient(settings.provider) }
    const { runDag } = await import("@newhorse/runtime")
    const outcome = await runDag(spec, { events, inbox, runtime, tools, workspace: settings.workspace, defaultModel: settings.model, maxRetries: 2 })
    for (const [id, st] of Object.entries(outcome.status)) {
      console.log(`${st.padEnd(10)} ${id}${outcome.models[id] ? `  (${outcome.models[id]})` : ""}`)
    }
    return
  }
  const runner = createDagRunner({
    dataDir: settings.dataDir,
    getProvider: () => settings.provider,
    getDefaultModel: () => settings.model,
    getWorkspace: () => settings.workspace,
    enableBash: settings.allowBash,
  })
  const dagId = rest[0]
  if (!dagId) {
    for (const st of await runner.list()) {
      console.log(`${st.dagId}  ${st.done ? "done" : "RUNNING"}  ${st.nodes.map((n) => `${n.node}:${n.state}`).join(" ")}`)
    }
    return
  }
  const st = await runner.status(dagId)
  if (!st) throw new Error(`no DAG with id ${dagId}`)
  for (const n of st.nodes) {
    console.log(`${n.state.padEnd(10)} ${n.node}${n.model ? `  (${n.model})` : ""}${n.childSessionId ? `  → ${n.childSessionId}` : ""}`)
  }
}

// --- helpers ---

/** Append-only fork (codex backtrack semantics — mirrors the server route):
 *  copy events ≤ atSeq (minus the original Created), then re-Create with the
 *  source's workspace/role. Never truncates the source. */
async function forkSession(app: Awaited<ReturnType<typeof buildApp>>, atSeq: number | undefined): Promise<{ newId: string; atSeq: number }> {
  const source = await app.events.read(app.sessionId)
  const created = source.find((e) => e.type === "Session.Created")
  const sourceData = (created?.data ?? {}) as { location?: string; role?: "butler" }
  const cutoff = atSeq ?? Number.MAX_SAFE_INTEGER
  const prefix = source.filter((e) => e.seq <= cutoff && e.type !== "Session.Created")
  if (prefix.length === 0) throw new Error("nothing to fork at that seq")
  const newId = crypto.randomUUID()
  for (const e of prefix) await app.events.append(newId, e.type, e.data)
  await app.events.append(newId, "Session.Created", {
    id: newId,
    location: sourceData.location ?? "",
    createdAt: Date.now(),
    ...(sourceData.role ? { role: sourceData.role } : {}),
  })
  return { newId, atSeq: Math.min(cutoff, prefix[prefix.length - 1]!.seq) }
}

function resolveSessionId(flags: Record<string, string>, settings: ReturnType<typeof loadRuntimeSettings>): string | undefined {
  if (flags.session) return flags.session
  if (process.env.NEWHORSE_SESSION) return process.env.NEWHORSE_SESSION
  return undefined
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ""
  let text = ""
  for await (const chunk of process.stdin) text += chunk
  return text.trim()
}

/** Ask the user a yes/no question on a TTY; a non-TTY (piped input) fails
 * closed (returns false) rather than hanging waiting for a human that never
 * answers. */
async function askUser(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>((resolvePromise) => {
      rl.question(prompt, (a) => resolvePromise(a.trim()))
    })
    return answer === "y" || answer === "Y"
  } finally {
    rl.close()
  }
}

function printMessage(message: SessionMessage): void {
  if (message.kind === "user") {
    process.stdout.write(`\u001b[36m> \u001b[0m${message.text}\n`)
  } else if (message.kind === "assistant") {
    const text = message.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("")
    if (text) process.stdout.write(`\u001b[32m${text}\u001b[0m\n`)
  }
}

/** Interactive REPL: type a prompt, /help for commands. Ctrl-C cancels the
 *  CURRENT run (the next prompt starts fresh — a per-run AbortController). */
async function repl(app: Awaited<ReturnType<typeof buildApp>>): Promise<void> {
  console.log("newhorse REPL — type a message, /help for commands. Ctrl-C interrupts the current run.")
  app.onEvent((event) => {
    if (event.type === "text") process.stdout.write(event.text)
    else if (event.type === "error") process.stderr.write(`\u001b[31m${event.message}\u001b[0m\n`)
    else if (event.type === "done") process.stdout.write(`\n`)
  })
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let rlClosed = false
  rl.on("close", () => { rlClosed = true })
  rl.on("SIGINT", () => {
    app.interrupt()
    process.stdout.write("\u001b[2m(interrupting…)\u001b[0m\n")
  })
  const ask = (): void => {
    if (rlClosed) return
    rl.question("> ", (line) => void handle(line))
  }
  const handle = async (line: string): Promise<void> => {
    try {
      const text = line.trim()
      if (text === "/quit" || text === "/exit") { rl.close(); process.exit(0); return }
      if (text === "/help") { console.log("  <text>  /steer <text>  /todos  /goal  /context  /compact  /fork [seq]  /title <text>  /policy [level]  /list  /interrupt  /quit"); return }
      if (text === "/list" || text === "/sessions") { console.log(JSON.stringify(await app.listSessions(), null, 2)); return }
      if (text === "/todos") {
        const todos = await app.todos()
        if (todos.length === 0) { console.log("(no todos)"); return }
        for (const t of todos) {
          const mark = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : t.status === "cancelled" ? "[-]" : "[ ]"
          const label = t.status === "in_progress" && t.activeForm ? t.activeForm : t.content
          console.log(`${mark} ${label}`)
        }
        return
      }
      if (text === "/goal") {
        const g = await app.goal()
        if (!g) { console.log("(no goal set — the model can set one via goal_write)"); return }
        const budget = g.tokenBudget !== undefined ? ` | budget ${g.tokensUsed}/${g.tokenBudget} tokens${g.tokenBudget !== undefined && g.tokensUsed > g.tokenBudget ? " (OVER)" : ""}` : ` | ${g.tokensUsed} tokens used`
        console.log(`[${g.status}] ${g.objective}${budget}`)
        return
      }
      if (text === "/interrupt") { app.interrupt(); return }
      if (text === "/compact") { const r = await app.compact(); console.log(`compacted at seq ${r.boundarySeq}`); return }
      if (text.startsWith("/fork")) { const seq = rest1(text) ? Number(rest1(text)) : undefined; const r = await forkSession(app, Number.isFinite(seq) ? seq : undefined); console.log(`forked → ${r.newId} (at seq ${r.atSeq})`); return }
      if (text.startsWith("/title ")) { const t = text.slice(7).trim(); if (!t) { console.log("usage: /title <text>"); return } await app.events.append(app.sessionId, "Session.TitleSet", { sessionId: app.sessionId, title: t, ts: Date.now() }); console.log(`title set: ${t}`); return }
      if (text === "/policy" || text.startsWith("/policy ")) { const p = rest1(text); if (p) { if (p !== "strict" && p !== "readonly" && p !== "trusted") { console.log("policy must be strict | readonly | trusted"); return } await app.setPolicy(p) } console.log(`policy: ${app.policy()}`); return }
      if (text.startsWith("/steer ")) { await app.steer(text.slice(7).trim()); return }
      if (!text) return
      // A slash command resolves against the plugin seam (never interpreted here).
      if (text.startsWith("/")) {
        const output = await app.runCommand(text)
        console.log(typeof output === "string" ? output : JSON.stringify(output, null, 2))
        return
      }
      try {
        const result = await app.prompt(text, "user")
        console.log(`\u001b[2m(done: ${result.finish}, ${result.step} step(s))\u001b[0m`)
      } catch (e) {
        console.error(`\u001b[31m${e instanceof Error ? e.message : String(e)}\u001b[0m`)
      }
    } catch (e) {
      // A throwing sub-command (list/steer/runCommand) must never kill the REPL.
      console.error(`\u001b[31m${e instanceof Error ? e.message : String(e)}\u001b[0m`)
    } finally {
      ask() // always re-arm — the loop never dies silently.
    }
  }
  ask()
}

/** "/cmd arg" → "arg" ("" when absent) — REPL argument helper. */
function rest1(text: string): string {
  const i = text.indexOf(" ")
  return i === -1 ? "" : text.slice(i + 1).trim()
}
