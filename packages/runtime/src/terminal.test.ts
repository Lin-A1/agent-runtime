import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TerminalSession, createSharedTerminalTools } from "./terminal"
import type { ToolCtx } from "@newhorse/core"

const isWin = process.platform === "win32"

async function withTerminal(fn: (t: TerminalSession) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "nh-term-"))
  const t = new TerminalSession(cwd)
  try {
    await fn(t)
  } finally {
    t.dispose()
    await rm(cwd, { recursive: true, force: true }).catch(() => {})
  }
}

describe("shared workbench terminal", () => {
  it("agentSend runs a command to completion and returns output + exit code", async () => {
    await withTerminal(async (t) => {
      const r = await t.agentSend(`echo nh-shared-probe-${"x".repeat(1)}`, 30_000)
      expect(r.exitCode).toBe(0)
      expect(r.output).toContain("nh-shared-probe-")
      // Sentinel boundary lines must never leak into the output.
      expect(r.output.includes("__NH_DONE_")).toBe(false)
    })
  })

  it("humanSend output lands in the shared stream the agent can read", async () => {
    await withTerminal(async (t) => {
      t.humanSend(`echo human-was-here`)
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const { text } = t.read(0)
        if (text.includes("human-was-here")) return
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error("human command output never appeared in the shared stream")
    })
  })

  it("read() is incremental: the cursor only moves forward", async () => {
    await withTerminal(async (t) => {
      await t.agentSend("echo one", 30_000)
      const first = t.read(0)
      expect(first.text).toContain("one")
      const at = first.cursor
      await t.agentSend("echo two", 30_000)
      const second = t.read(at)
      expect(second.cursor).toBeGreaterThanOrEqual(at)
      expect(second.text).toContain("two")
      expect(second.text).not.toContain("one")
    })
  })

  it("activity ledger attributes inputs to human and agent", async () => {
    await withTerminal(async (t) => {
      t.humanSend("echo from-human")
      await t.agentSend("echo from-agent", 30_000)
      const activity = t.activity()
      expect(activity.some((a) => a.source === "human" && a.text === "echo from-human")).toBe(true)
      expect(activity.some((a) => a.source === "agent" && a.text === "echo from-agent")).toBe(true)
    })
  })

  it("terminal_send tool honors the exec policy floor (deny + allow)", async () => {
    await withTerminal(async (t) => {
      const tools = createSharedTerminalTools(t)
      const send = tools.find((tool) => tool.name === "terminal_send")!
      const denyAll: ToolCtx = { caller: { kind: "user" }, execPolicy: { decide: () => "forbid", decidePath: () => "allow" } }
      const denied = await send.execute({ command: "echo hi" }, denyAll) as { error?: string }
      expect(denied.error).toContain("denied by execpolicy")

      const allowAll: ToolCtx = { caller: { kind: "user" }, execPolicy: { decide: () => "allow", decidePath: () => "allow" } }
      const ok = await send.execute({ command: "echo tool-probe" }, allowAll) as { exitCode?: number; output?: string }
      expect(ok.exitCode).toBe(0)
      expect(ok.output).toContain("tool-probe")
    })
  }, 30_000)
})
