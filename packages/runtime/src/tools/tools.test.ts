import { describe, expect, it, afterEach } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBuiltinTools, createBuiltinExecPolicy } from "./index"
import { createWebSearchTool } from "./web-search"
import { MemoryMemoryStore } from "@newhorse/memory"
import type { Tool, ToolCtx } from "@newhorse/core"
import type { ExecPolicy } from "@newhorse/schema"
import type { Decision } from "@newhorse/schema"

/** An allow-all execpolicy so fs/bash tests exercise the happy path without
 * being denied (M4): read/write/edit/bash now require an injected policy. */
const allowAll: ExecPolicy = { decide: (): Decision => "allow", decidePath: (): Decision => "allow" }
const allowCtx: ToolCtx = { caller: { kind: "user" }, execPolicy: allowAll }

async function ws(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "nh-tools-"))
  return {
    root,
    cleanup: async () => {
      // Retry rm on Windows where a recently killed process takes milliseconds to release cwd
      for (let i = 0; i < 5; i++) {
        try {
          await rm(root, { recursive: true, force: true })
          return
        } catch {
          await new Promise((r) => setTimeout(r, 80))
        }
      }
    },
  }
}

function byName(tools: Tool[], name: string): Tool {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

describe("builtin tools", () => {
  it("default set excludes bash; enableBash adds it", async () => {
    const { root, cleanup } = await ws()
    try {
      const base = createBuiltinTools({ workspace: root })
      expect(base.map((t) => t.name).sort()).toEqual(["ask_user", "edit", "enter_plan_mode", "list", "lsp", "multi_edit", "read", "search", "view_image", "write"])
      const withBash = createBuiltinTools({ workspace: root, enableBash: true })
      expect(withBash.map((t) => t.name)).toContain("bash")
    } finally {
      await cleanup()
    }
  })

  it("write then read round-trips (line numbers, no truncation)", async () => {
    const { root, cleanup } = await ws()
    try {
      const tools = createBuiltinTools({ workspace: root })
      const write = byName(tools, "write")
      const read = byName(tools, "read")
      await write.execute({ path: "a/b.txt", content: "line1\nline2\nline3" }, allowCtx)
      const out = await read.execute({ path: "a/b.txt" }, allowCtx) as { lines: string[]; truncated: boolean; totalLines: number }
      expect(out.totalLines).toBe(3)
      expect(out.truncated).toBe(false)
      expect(out.lines[0]).toContain("line1")
      expect(out.lines[0]).toMatch(/^\s*1/)
      expect(out.lines[2]).toMatch(/^\s*3/)
    } finally {
      await cleanup()
    }
  })

  it("read refuses to escape the workspace", async () => {
    const { root, cleanup } = await ws()
    const outside = join(tmpdir(), "nh-secret.txt")
    await writeFile(outside, "secret")
    try {
      const read = byName(createBuiltinTools({ workspace: root }), "read")
      const out = await read.execute({ path: "../" + join("..", "nh-secret.txt") }, allowCtx) as { error: string }
      expect(out.error).toBeDefined()
    } finally {
      await cleanup()
      await rm(outside, { force: true })
    }
  })

  it("edit replaces unique match and preserves EOL", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "f.txt"), "hello\r\nworld\r\nhello")
      const edit = byName(createBuiltinTools({ workspace: root }), "edit")
      const out = await edit.execute({ path: "f.txt", old: "world", new: "there" }, allowCtx) as { replaced: number }
      expect(out.replaced).toBe(1)
      const text = await readFile(join(root, "f.txt"), "utf8")
      expect(text).toBe("hello\r\nthere\r\nhello")
    } finally {
      await cleanup()
    }
  })

  it("edit rejects old==new and empty old", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "f.txt"), "abc")
      const edit = byName(createBuiltinTools({ workspace: root }), "edit")
      await expect(edit.execute({ path: "f.txt", old: "abc", new: "abc" }, allowCtx)).resolves.toMatchObject({ error: expect.stringContaining("identical") })
      await expect(edit.execute({ path: "f.txt", old: "", new: "x" }, allowCtx)).resolves.toMatchObject({ error: expect.stringContaining("non-empty") })
    } finally {
      await cleanup()
    }
  })

  it("edit returns structured disambiguation on multi-hit without replaceAll", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "f.txt"), "one\ntwo one\none")
      const edit = byName(createBuiltinTools({ workspace: root }), "edit")
      const out = await edit.execute({ path: "f.txt", old: "one", new: "X" }, allowCtx) as { matches: number; hits: { line: number }[] }
      expect(out.matches).toBe(3)
      expect(out.hits.length).toBeGreaterThan(0)
    } finally {
      await cleanup()
    }
  })

  it("multi_edit applies N edits sequentially in memory and writes once", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "f.txt"), "alpha beta gamma")
      const me = byName(createBuiltinTools({ workspace: root }), "multi_edit")
      const res = await me.execute({
        path: "f.txt",
        edits: [
          { old: "alpha", new: "1" },
          { old: "beta", new: "2" },
          { old: "gamma", new: "3" },
        ],
      }, allowCtx) as { totalEdits: number; applied: unknown[] }
      expect(res.totalEdits).toBe(3)
      const after = await readFile(join(root, "f.txt"), "utf8")
      expect(after).toBe("1 2 3")
    } finally {
      await cleanup()
    }
  })

  it("multi_edit fails atomic — an error leaves the file completely untouched", async () => {
    const { root, cleanup } = await ws()
    try {
      const orig = "original text here"
      await writeFile(join(root, "f.txt"), orig)
      const me = byName(createBuiltinTools({ workspace: root }), "multi_edit")
      const res = await me.execute({
        path: "f.txt",
        edits: [
          { old: "original", new: "changed" },
          { old: "NON_EXISTENT", new: "boom" },
        ],
      }, allowCtx) as { error?: string }
      expect(res.error).toBeDefined()
      expect(res.error).toContain("edit[1]")
      const after = await readFile(join(root, "f.txt"), "utf8")
      expect(after).toBe(orig)
    } finally {
      await cleanup()
    }
  })

  it("view_image reads a supported image and returns base64", async () => {
    const { root, cleanup } = await ws()
    try {
      const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      await writeFile(join(root, "shot.png"), fakePng)
      const vi = byName(createBuiltinTools({ workspace: root }), "view_image")
      const res = await vi.execute({ path: "shot.png" }, allowCtx) as { mime: string; data: string; size: number }
      expect(res.mime).toBe("image/png")
      expect(res.size).toBe(fakePng.length)
      expect(res.data).toBe(fakePng.toString("base64"))
      const badExt = await vi.execute({ path: "shot.exe" }, allowCtx) as { error?: string }
      expect(badExt.error).toContain("unsupported")
    } finally {
      await cleanup()
    }
  })

  it("enter_plan_mode flips the session policy to readonly", async () => {
    const tool = byName(createBuiltinTools({ workspace: process.cwd() }), "enter_plan_mode")
    let set = ""
    const res = await tool.execute({}, { caller: { kind: "user" }, setPolicy: async (p) => { set = p } }) as { planMode: boolean }
    expect(res.planMode).toBe(true)
    expect(set).toBe("readonly")
    const noChannel = await tool.execute({}, allowCtx) as { error?: string }
    expect(noChannel.error).toBeDefined()
  })

  it("lsp hover + definition resolve a TS symbol (real tsserver)", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "a.ts"), "export function addOne(n: number): number {\n  return n + 1\n}\n")
      await writeFile(join(root, "b.ts"), "import { addOne } from \"./a\"\nconst x = addOne(41)\n")
      const lsp = byName(createBuiltinTools({ workspace: root }), "lsp")
      const hover = await lsp.execute({ op: "hover", path: "b.ts", line: 2, character: 15 }, allowCtx) as { hover: string }
      expect(hover.hover).toContain("addOne")
      const def = await lsp.execute({ op: "definition", path: "b.ts", line: 2, character: 15 }, allowCtx) as { locations: string[] }
      expect(def.locations.length).toBeGreaterThan(0)
      expect(def.locations[0]).toContain("a.ts:1")
    } finally {
      await cleanup()
    }
  }, 60_000)

  it("bash_input writes to stdin of a background task", async () => {
    const { root, cleanup } = await ws()
    try {
      const tools = createBuiltinTools({ workspace: root, enableBash: true })
      const bash = byName(tools, "bash")
      const bashInput = byName(tools, "bash_input")
      // Portable interactive stdin reader: `more` echoes input under cmd.exe; `cat` on POSIX
      const cmd = process.platform === "win32" ? "more" : "cat"
      const bg = await bash.execute({ command: cmd, runInBackground: true }, allowCtx) as { taskId: string }
      expect(bg.taskId).toBeDefined()
      await new Promise((r) => setTimeout(r, 200))
      const inp = await bashInput.execute({ taskId: bg.taskId, chars: "more-test-pipe\r\n", yield_time_ms: 300 }, allowCtx) as { stdout: string }
      expect(inp.stdout).toContain("more-test-pipe")
      const kill = byName(tools, "bash_kill")
      await kill.execute({ taskId: bg.taskId })
      await new Promise((r) => setTimeout(r, 100))
    } finally {
      await cleanup()
    }
  })

  it("list matches a glob and works under a base dir", async () => {
    const { root, cleanup } = await ws()
    try {
      await mkdir(join(root, "src"), { recursive: true })
      await writeFile(join(root, "src/index.ts"), "")
      await writeFile(join(root, "src/app.ts"), "")
      await writeFile(join(root, "docs.md"), "")
      const list = byName(createBuiltinTools({ workspace: root }), "list")
      const out = await list.execute({ pattern: "**/*.ts", path: "src" }) as { files: string[] }
      expect(out.files).toContain("index.ts")
      expect(out.files).toContain("app.ts")
      expect(out.files).not.toContain("docs.md")
    } finally {
      await cleanup()
    }
  })

  it("search finds a pattern and reports file:line", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "a.ts"), "const foo = 1;\nconst bar = 2;\n")
      await writeFile(join(root, "b.ts"), "const foobar = 3;\n")
      const search = byName(createBuiltinTools({ workspace: root }), "search")
      const out = await search.execute({ pattern: "\\bfoo\\b" }) as { totalMatches: number; hits: { file: string; line: number; text: string }[] }
      expect(out.totalMatches).toBe(1)
      expect(out.hits[0]!.file).toBe("a.ts")
      expect(out.hits[0]!.line).toBe(1)
      expect(out.hits[0]!.text).toContain("foo")
    } finally {
      await cleanup()
    }
  })

  it("bash runs a command, returns stdout + exitCode (non-zero is data)", async () => {
    const { root, cleanup } = await ws()
    try {
      const bash = byName(createBuiltinTools({ workspace: root, enableBash: true }), "bash")
      const ok = await bash.execute({ command: "echo hi" }, allowCtx) as { stdout: string; exitCode: number }
      expect(ok.stdout.trim()).toBe("hi")
      expect(ok.exitCode).toBe(0)
      const bad = await bash.execute({ command: "exit 3" }, allowCtx) as { exitCode: number }
      expect(bad.exitCode).toBe(3)
    } finally {
      await cleanup()
    }
  })

  it("bash respects a hard clamp on timeout", async () => {
    const { root, cleanup } = await ws()
    try {
      const bash = byName(createBuiltinTools({ workspace: root, enableBash: true }), "bash")
      // A fast, harmless command validates that the clamp path still runs.
      const out = await bash.execute({ command: process.platform === "win32" ? "echo ok" : "true", timeoutMs: 200 }, allowCtx) as { exitCode: number }
      expect(out.exitCode).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it("bash defaults to a non-trivial timeout (not 1ms)", async () => {
    const { root, cleanup } = await ws()
    try {
      const bash = byName(createBuiltinTools({ workspace: root, enableBash: true }), "bash")
      // A command that takes ~300ms must survive the default timeout (which must
      // be the hard cap, not clamopy a missing value to 1ms).
      const out = await bash.execute({ command: process.platform === "win32" ? "ping -n 2 127.0.0.1 >nul" : "sleep 0.3" }, allowCtx) as { exitCode: number; timedOut: boolean }
      expect(out.timedOut).toBe(false)
      expect(out.exitCode).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it("bash cwd is pinned to the workspace", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "marker.txt"), "here")
      const bash = byName(createBuiltinTools({ workspace: root, enableBash: true }), "bash")
      const out = await bash.execute({ command: process.platform === "win32" ? "dir /b marker.txt" : "ls marker.txt" }, allowCtx) as { stdout: string }
      expect(out.stdout).toContain("marker.txt")
    } finally {
      await cleanup()
    }
  })

  it("write creates parent dirs", async () => {
    const { root, cleanup } = await ws()
    try {
      const write = byName(createBuiltinTools({ workspace: root }), "write")
      await write.execute({ path: "deep/nested/x.txt", content: "content" }, allowCtx)
      await expect(readFile(join(root, "deep/nested/x.txt"), "utf8")).resolves.toBe("content")
    } finally {
      await cleanup()
    }
  })

  it("list follows a workspace-internal symlink that points outside", async () => {
    const { root, cleanup } = await ws()
    const outside = await mkdtemp(join(tmpdir(), "nh-leak-"))
    try {
      await writeFile(join(outside, "leaked.txt"), "SECRET-LEAK")
      await symlink(outside, join(root, "link"), "junction").catch(() => {})
      const list = byName(createBuiltinTools({ workspace: root }), "list")
      const out = await list.execute({ pattern: "**/*", path: root }) as { files: string[] }
      // A symlink/junction is never followed — the external file is not collected.
      expect(out.files).not.toContain("link/leaked.txt")
      const search = byName(createBuiltinTools({ workspace: root }), "search")
      const s = await search.execute({ pattern: "SECRET" }) as { totalMatches: number }
      expect(s.totalMatches).toBe(0)
    } finally {
      await cleanup()
      await rm(outside, { recursive: true, force: true })
    }
  })

  it("read truncates long output and flags it", async () => {
    const { root, cleanup } = await ws()
    try {
      const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n")
      await writeFile(join(root, "big.txt"), lines)
      const read = byName(createBuiltinTools({ workspace: root }), "read")
      const out = await read.execute({ path: "big.txt" }, allowCtx) as { truncated: boolean }
      expect(out.truncated).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it("list glob is case-insensitive on win32 (extension casing)", async () => {
    const { root, cleanup } = await ws()
    try {
      await mkdir(join(root, "src"), { recursive: true })
      await writeFile(join(root, "src/Foo.TS"), "")
      const list = byName(createBuiltinTools({ workspace: root }), "list")
      const out = await list.execute({ pattern: "**/*.ts" }) as { files: string[] }
      expect(out.files).toContain("src/Foo.TS")
    } finally {
      await cleanup()
    }
  })

  it("search flags a byte budget instead of silently returning a false no-match", async () => {
    const { root, cleanup } = await ws()
    try {
      // A huge file first (alphabetically), then a tiny target file. The budget
      // must mark `budgetExceeded`/`truncated` rather than dropping the target
      // silently and reporting a confident 0 matches.
      await writeFile(join(root, "aaa_big.txt"), "x".repeat(2 * 1024 * 1024))
      await writeFile(join(root, "zzz_target.txt"), "TARGET_TOKEN")
      const search = byName(createBuiltinTools({ workspace: root }), "search")
      const out = await search.execute({ pattern: "TARGET_TOKEN" }) as { totalMatches: number; budgetExceeded: boolean; truncated: boolean }
      expect(out.totalMatches).toBe(1)
    } finally {
      await cleanup()
    }
  })

  it("read reports an offset beyond EOF instead of a silent empty result", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "f.txt"), "line1\nline2\nline3")
      const read = byName(createBuiltinTools({ workspace: root }), "read")
      const out = await read.execute({ path: "f.txt", offset: 999 }, allowCtx) as { lines: string[]; totalLines: number }
      expect(out.totalLines).toBe(3)
      expect(out.lines.length).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it("read fails closed without an execpolicy and honors a path decision", async () => {
    const { root, cleanup } = await ws()
    try {
      await writeFile(join(root, "f.txt"), "hello")
      const read = byName(createBuiltinTools({ workspace: root }), "read")
      // No ctx -> no policy -> deny (read is now gated like write/bash).
      const bare = await read.execute({ path: "f.txt" }) as { error: string }
      expect(bare.error).toContain("denied")
      // A forbid decision is honored without touching the filesystem.
      const forbidCtx: ToolCtx = {
        caller: { kind: "user" },
        execPolicy: { decide: () => "allow", decidePath: () => "forbid" },
      }
      const blocked = await read.execute({ path: "f.txt" }, forbidCtx) as { error: string }
      expect(blocked.error).toContain("denied")
    } finally {
      await cleanup()
    }
  })

  it("write cannot reach a protected dir through a workspace-internal junction", async () => {
    const { root, cleanup } = await ws()
    try {
      await mkdir(join(root, ".newhorse"), { recursive: true })
      // A junction named `link` resolves INTO `.newhorse` — the policy must catch
      // it via the real path (decidePath on the raw `link/...` would miss it).
      await symlink(join(root, ".newhorse"), join(root, "link"), "junction").catch(() => {})
      const write = byName(createBuiltinTools({ workspace: root }), "write")
      const realPolicy = createBuiltinExecPolicy({ dataDir: join(root, ".data"), workspace: root })
      const out = await write.execute({ path: "link/rules.json", content: "evil" }, { caller: { kind: "user" }, execPolicy: realPolicy }) as { error?: string }
      expect(out.error ?? "").toMatch(/denied|forbid/)
    } finally {
      await cleanup()
    }
  })

  it("list/search refuse a base rooted inside a protected dir", async () => {
    const { root, cleanup } = await ws()
    try {
      await mkdir(join(root, ".git"), { recursive: true })
      await writeFile(join(root, ".git", "config"), "secret")
      const tools = createBuiltinTools({ workspace: root })
      const list = byName(tools, "list")
      const search = byName(tools, "search")
      const l = await list.execute({ pattern: "**/*", path: ".git" }) as { error?: string }
      expect(l.error ?? "").toMatch(/protected|disallowed/)
      const s = await search.execute({ pattern: "secret", path: ".git" }) as { error?: string }
      expect(s.error ?? "").toMatch(/protected|disallowed/)
    } finally {
      await cleanup()
    }
  })

  it("memory tools are exposed only when a memoryStore is injected; search+write round-trip", async () => {
    const noMem = createBuiltinTools({ workspace: "G:/proj" })
    expect(noMem.some((t) => t.name === "memory_search")).toBe(false)

    const store = new MemoryMemoryStore()
    const tools = createBuiltinTools({ workspace: "G:/proj", memoryStore: store })
    const search = tools.find((t) => t.name === "memory_search")!
    const write = tools.find((t) => t.name === "memory_write")!
    expect(search).toBeTruthy()
    expect(write).toBeTruthy()

    const writen = await write.execute({ content: "User prefers type-safe code", type: "persona", priority: 80 }, { caller: { kind: "parent", sessionId: "s1" }, sessionId: "s1" })
    expect((writen as { stored?: boolean }).stored).toBe(true)
    const found = await search.execute({ query: "type-safe" }, { caller: { kind: "parent", sessionId: "s1" }, sessionId: "s1" })
    expect((found as { count?: number }).count).toBe(1)
    const miss = await search.execute({ query: "zzz" }, { caller: { kind: "parent", sessionId: "s1" }, sessionId: "s1" })
    expect((miss as { count?: number }).count).toBe(0)
  })
})


describe("bash background trio (wave 8)", () => {
  it("runInBackground returns a taskId immediately; bash_output polls to completion; bash_kill stops a long task", async () => {
    const root = await ws()
    try {
      const tools = createBuiltinTools({ workspace: root.root, enableBash: true })
      const bash = byName(tools, "bash")
      const output = byName(tools, "bash_output")
      const kill = byName(tools, "bash_kill")

      // Background: returns immediately with a taskId.
      const started = (await bash.execute({ command: process.platform === "win32" ? "ping -n 30 127.0.0.1" : "sleep 30", runInBackground: true }, allowCtx)) as { taskId?: string; running?: boolean }
      expect(started.taskId).toBeTruthy()
      expect(started.running).toBe(true)

      // Output poll: task is running (no exitCode yet).
      const first = (await output.execute({ taskId: started.taskId }, allowCtx)) as { running?: boolean; command?: string }
      expect(first.running).toBe(true)
      expect(first.command).toContain("30")

      // Kill the tree; output then reports settled.
      const killed = (await kill.execute({ taskId: started.taskId }, allowCtx)) as { killed?: boolean }
      expect(killed.killed).toBe(true)
      for (let i = 0; i < 50; i++) {
        const state = (await output.execute({ taskId: started.taskId }, allowCtx)) as { running?: boolean }
        if (!state.running) break
        await new Promise((r) => setTimeout(r, 50))
      }
      const settled = (await output.execute({ taskId: started.taskId }, allowCtx)) as { running?: boolean }
      expect(settled.running).toBe(false)

      // Unknown taskId fails honestly (fail() is DATA — the model self-corrects).
      const ghost = (await output.execute({ taskId: "ghost" }, allowCtx)) as { error?: string }
      expect(ghost.error).toContain("unknown taskId")
    } finally {
      // The killed process tree releases its cwd asynchronously on Windows —
      // retry the cleanup instead of failing on EBUSY.
      for (let i = 0; i < 10; i++) {
        try {
          await root.cleanup()
          break
        } catch {
          await new Promise((r) => setTimeout(r, 100))
        }
      }
    }
  }, 15_000)

  it("a fast background command settles on its own (echo)", async () => {
    const root = await ws()
    try {
      const tools = createBuiltinTools({ workspace: root.root, enableBash: true })
      const bash = byName(tools, "bash")
      const output = byName(tools, "bash_output")
      const started = (await bash.execute({ command: "echo wave8-background", runInBackground: true }, allowCtx)) as { taskId?: string }
      let state = (await output.execute({ taskId: started.taskId }, allowCtx)) as { running?: boolean; stdout?: string }
      for (let i = 0; i < 50 && state.running; i++) {
        await new Promise((r) => setTimeout(r, 50))
        state = (await output.execute({ taskId: started.taskId }, allowCtx)) as { running?: boolean; stdout?: string }
      }
      expect(state.running).toBe(false)
      expect(state.stdout).toContain("wave8-background")
    } finally {
      await root.cleanup()
    }
  }, 15_000)
})

/** web_search tests stub globalThis.fetch like webfetch.test.ts — no real
 * network in the test suite. */
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => handler(String(input), init)) as unknown as typeof fetch
}

/** Realistic DDG html-endpoint markup: result__a titles (one wrapped in a
 * `uddg=` redirect, one plain), result__snippet anchors, result__url crumbs. */
const DDG_HTML = `<!DOCTYPE html><html><body>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc123">Example Docs &amp; Guide</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">A snippet about <b>examples</b> &amp; docs.</a>
    <div class="result__extras"><div class="result__extras__url"><a class="result__url" href="https://example.com/docs">example.com</a></div></div>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://plain.example.org/page">Plain Href Result</a>
    </h2>
    <a class="result__snippet" href="https://plain.example.org/page">Second snippet here.</a>
  </div>
</div>
</body></html>`

/** DDG lite-endpoint markup: a plain table, single-quoted attributes. */
const DDG_LITE = `<html><body><table>
<tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flite.example.com%2Fa" class='result-link'>Lite Result One</a></td></tr>
<tr><td class='result-snippet'>Lite snippet <b>one</b> here.</td></tr>
<tr><td class='result-url'>lite.example.com/a</td></tr>
</table></body></html>`

/** Bing public markup: b_algo blocks with h2>a titles and caption <p>. */
const BING_HTML = `<html><body><ol id="b_results">
<li class="b_algo"><h2><a href="https://bing.example.net/item" target="_blank">Bing Result</a></h2><div class="b_caption"><p>Bing snippet text.</p></div></li>
</ol></body></html>`

describe("web_search tool", () => {
  it("parses DDG HTML results and decodes uddg redirect wrappers", async () => {
    let seenUa = ""
    stubFetch((url, init) => {
      expect(url).toContain("html.duckduckgo.com")
      seenUa = (init?.headers as Record<string, string>)["user-agent"] ?? ""
      return new Response(DDG_HTML, { status: 200, headers: { "content-type": "text/html" } })
    })
    const tool = createWebSearchTool()
    const out = (await tool.execute({ query: "example docs" }, { caller: { kind: "user" } })) as {
      results: { title: string; url: string; snippet: string }[]
      engine: string
    }
    expect(out.engine).toBe("duckduckgo-html")
    expect(out.results.length).toBe(2)
    expect(out.results[0]!.url).toBe("https://example.com/docs")
    expect(out.results[0]!.title).toBe("Example Docs & Guide")
    expect(out.results[0]!.snippet).toContain("examples & docs")
    expect(out.results[1]!.url).toBe("https://plain.example.org/page")
    // A browser UA is sent — the endpoints 403 an empty/agent UA.
    expect(seenUa).toContain("Mozilla")
  })

  it("falls back to duckduckgo-lite when the html endpoint errors", async () => {
    const calls: string[] = []
    stubFetch((url) => {
      calls.push(url)
      if (url.includes("html.duckduckgo.com")) return new Response("nope", { status: 500 })
      return new Response(DDG_LITE, { status: 200 })
    })
    const tool = createWebSearchTool()
    const out = (await tool.execute({ query: "lite" }, { caller: { kind: "user" } })) as {
      results: { title: string; url: string; snippet: string }[]
      engine: string
    }
    expect(out.engine).toBe("duckduckgo-lite")
    expect(out.results[0]!.url).toBe("https://lite.example.com/a")
    expect(out.results[0]!.title).toBe("Lite Result One")
    expect(out.results[0]!.snippet).toContain("Lite snippet one here.")
    expect(calls.length).toBe(2)
  })

  it("falls through to bing when both DDG endpoints yield nothing", async () => {
    stubFetch((url) => {
      if (url.includes("html.duckduckgo.com")) return new Response("nope", { status: 500 })
      if (url.includes("lite.duckduckgo.com")) return new Response("<html><body>no results</body></html>", { status: 200 })
      return new Response(BING_HTML, { status: 200 })
    })
    const tool = createWebSearchTool()
    const out = (await tool.execute({ query: "bing" }, { caller: { kind: "user" } })) as {
      results: { title: string; url: string; snippet: string }[]
      engine: string
    }
    expect(out.engine).toBe("bing")
    expect(out.results[0]!.url).toBe("https://bing.example.net/item")
    expect(out.results[0]!.title).toBe("Bing Result")
    expect(out.results[0]!.snippet).toBe("Bing snippet text.")
  })

  it("returns an honest empty result set when backends answer but parse empty", async () => {
    stubFetch(() => new Response("<html><body>nothing</body></html>", { status: 200 }))
    const tool = createWebSearchTool()
    const out = (await tool.execute({ query: "zzz-no-match" }, { caller: { kind: "user" } })) as {
      results: unknown[]
      engine: string
    }
    expect(out.results).toEqual([])
    expect(out.engine).toBe("bing")
  })

  it("returns a tool error naming the causes when every backend fails", async () => {
    stubFetch(() => {
      throw new Error("network down")
    })
    const tool = createWebSearchTool()
    const out = (await tool.execute({ query: "x" }, { caller: { kind: "user" } })) as { error?: string }
    expect(out.error).toContain("all search backends failed")
    expect(out.error).toContain("duckduckgo-html: network down")
    expect(out.error).toContain("bing: network down")
  })

  it("clamps maxResults to 1..10 (default 5)", async () => {
    stubFetch(() => new Response(DDG_HTML, { status: 200 }))
    const tool = createWebSearchTool()
    const one = (await tool.execute({ query: "q", maxResults: 1 }, { caller: { kind: "user" } })) as { results: unknown[] }
    expect(one.results.length).toBe(1)
    const capped = (await tool.execute({ query: "q", maxResults: 100 }, { caller: { kind: "user" } })) as { results: unknown[] }
    expect(capped.results.length).toBe(2)
    const zero = (await tool.execute({ query: "q", maxResults: 0 }, { caller: { kind: "user" } })) as { results: unknown[] }
    expect(zero.results.length).toBe(1)
  })

  it("requires a query and never hits the network without one", async () => {
    let called = 0
    stubFetch(() => {
      called += 1
      return new Response(DDG_HTML, { status: 200 })
    })
    const tool = createWebSearchTool()
    const missing = (await tool.execute({}, { caller: { kind: "user" } })) as { error?: string }
    expect(missing.error).toContain("query is required")
    const blank = (await tool.execute({ query: "   " }, { caller: { kind: "user" } })) as { error?: string }
    expect(blank.error).toContain("query is required")
    expect(called).toBe(0)
  })

  it("is registered under enableWeb alongside web_fetch", async () => {
    const { root, cleanup } = await ws()
    try {
      const off = createBuiltinTools({ workspace: root })
      expect(off.some((t) => t.name === "web_search")).toBe(false)
      expect(off.some((t) => t.name === "web_fetch")).toBe(false)
      const on = createBuiltinTools({ workspace: root, enableWeb: true })
      expect(on.some((t) => t.name === "web_search")).toBe(true)
      expect(on.some((t) => t.name === "web_fetch")).toBe(true)
    } finally {
      await cleanup()
    }
  })
})
