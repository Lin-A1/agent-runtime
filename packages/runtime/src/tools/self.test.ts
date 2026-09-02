import { describe, expect, it } from "bun:test"
import { MemoryEventStore } from "@newhorse/core"
import { createSelfTools } from "./self"

function makeTools(overrides: Partial<Parameters<typeof createSelfTools>[0]> = {}) {
  const events = new MemoryEventStore()
  const policy = { value: "strict" as "strict" | "readonly" | "trusted" }
  const tools = createSelfTools({
    sessionId: "s1",
    workspace: "/proj",
    role: "newhorse 常驻会话",
    model: "test-model",
    providerKind: "openai-compatible",
    approvalPolicy: () => policy.value,
    toolCount: () => 21,
    events,
    contextWindowTokens: 1_000,
    ...overrides,
  })
  return { events, tools, policy }
}

describe("self-awareness tools (wave 9)", () => {
  it("self_status reports identity, location, config dirs, live policy, and time", async () => {
    const { tools, policy } = makeTools({ dataDir: "/home/d", agentHome: "/home/.newhorse" })
    const status = (await tools.find((t) => t.name === "self_status")!.execute({})) as Record<string, unknown>
    expect(status.product).toBe("newhorse")
    expect(status.role).toBe("newhorse 常驻会话")
    expect(status.model).toBe("test-model")
    expect(status.providerKind).toBe("openai-compatible")
    expect(status.sessionId).toBe("s1")
    expect(status.workspace).toBe("/proj")
    expect(status.dataDir).toBe("/home/d")
    expect(status.agentHome).toBe("/home/.newhorse")
    expect(status.approvalPolicy).toBe("strict")
    expect(status.tools).toBe(21)
    expect(status.platform).toBe(process.platform)
    expect(typeof status.time).toBe("string")
    // The policy closure reads LIVE state, not a snapshot.
    policy.value = "trusted"
    const again = (await tools.find((t) => t.name === "self_status")!.execute({})) as Record<string, unknown>
    expect(again.approvalPolicy).toBe("trusted")
  })

  it("get_context_remaining measures the projected view against the window", async () => {
    const { events, tools } = makeTools()
    await events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    await events.append("s1", "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: "a1", seq: 0, content: [{ type: "text", text: "some reply" }] } })
    const remaining = (await tools.find((t) => t.name === "get_context_remaining")!.execute({})) as Record<string, unknown>
    expect((remaining.visibleChars as number)).toBeGreaterThan(0)
    expect(remaining.windowTokens).toBe(1_000)
    expect(remaining.remainingTokens).toBe(1_000 - (remaining.estTokens as number))
    expect(remaining.compacted).toBe(false)
  })

  it("current_time returns parseable ISO with timezone; sleep clamps and honors abort", async () => {
    const { tools } = makeTools()
    const time = (await tools.find((t) => t.name === "current_time")!.execute({})) as { iso: string; epochMs: number; timezone: string }
    expect(Number.isNaN(Date.parse(time.iso))).toBe(false)
    expect(typeof time.timezone).toBe("string")

    const sleep = tools.find((t) => t.name === "sleep")!
    const start = Date.now()
    const slept = (await sleep.execute({ seconds: 0.05 })) as { slept: number; aborted: boolean }
    expect(slept.aborted).toBe(false)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)

    // An abort cancels the wait instead of stalling the drain.
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 20)
    const aborted = (await sleep.execute({ seconds: 30 }, { caller: { kind: "user" }, signal: ctrl.signal })) as { slept: number; aborted: boolean }
    expect(aborted.aborted).toBe(true)
  })
})
