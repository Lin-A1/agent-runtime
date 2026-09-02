import { describe, expect, it } from "bun:test"
import { MemoryEventStore } from "../session/store"
import { MemorySessionInput } from "../session/input"
import { clearStaleToolResults } from "./compaction"
import { runSession } from "./loop"
import type { TurnRuntime, Agent, Tool } from "./runner"
import type { LLMEvent, LLMRequest, SessionMessage } from "@newhorse/schema"

function makeRuntime(llm: TurnRuntime["llm"], tools: Tool[] = []): { runtime: TurnRuntime; resolveTool: (n: string) => Tool | undefined } {
  const events = new MemoryEventStore()
  const inbox = new MemorySessionInput(events)
  const map = new Map(tools.map((t) => [t.name, t]))
  return { runtime: { events, inbox, llm }, resolveTool: (n) => map.get(n) }
}

const agent: Agent = { id: "wave10", model: "test-model" }

function eventsOf(events: LLMEvent[]): AsyncIterable<LLMEvent> {
  return (async function* () {
    for (const e of events) yield e
  })()
}

function toolMsg(n: string, opts: { isError?: boolean } = {}): SessionMessage {
  return { kind: "tool", id: n, seq: 0, callId: `call_${n}`, name: n.startsWith("w") ? "write" : "search", output: `result-${n}`, ...(opts.isError ? { isError: true } : {}) }
}

describe("wave-10 compaction alignment", () => {
  it("provider-reported token pressure triggers compaction even when the char estimate is under the limit", async () => {
    // Round 1 reports the pressure AND keeps working (tool call) — the
    // pressure trigger must fire at round 2's start, before the next request.
    const llm: TurnRuntime["llm"] = {
      id: "t",
      stream: async () => {
        call += 1
        return call === 1
          ? eventsOf([
              { type: "tool-call", id: "c1", name: "search", input: { q: "x" } },
              { type: "step-finish", finish: "tool", usage: { inputTokens: 95_000, outputTokens: 10 } },
            ])
          : eventsOf([{ type: "text.delta", text: "ok" }, { type: "step-finish", finish: "stop" }])
      },
    }
    let call = 0
    const search: Tool = { name: "search", execute: async () => "ok" }
    const { runtime, resolveTool } = makeRuntime(llm, [search])
    await runtime.events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    // 14 small messages: far under the char limit (80k fallback) but foldable.
    for (let i = 0; i < 14; i++) await runtime.events.append("s1", "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: `a${i}`, seq: 0, content: [{ type: "text", text: `reply ${i}` }] } })
    await runtime.inbox.admit({ id: "m1", sessionId: "s1", prompt: "hi", delivery: "steer" })

    const result = await runSession(runtime, { agent, sessionId: "s1", resolveTool, contextWindowTokens: 100_000 })
    expect(result.finish).toBe("stop")
    const log = await runtime.events.read("s1")
    expect(log.filter((e) => e.type === "Session.Compacted")).toHaveLength(1)
  })

  it("clearStaleToolResults honors the clearable whitelist and keeps error results by default", () => {
    const messages: SessionMessage[] = [toolMsg("s1"), toolMsg("w1"), toolMsg("s2", { isError: true }), toolMsg("s3")]
    // keepRecent 1 → the three oldest are stale candidates; the whitelist only
    // allows "search", and errors are kept by default → only s1 clears.
    const out = clearStaleToolResults(messages, { keepRecent: 1, thresholdChars: 1, visibleChars: 9_000, clearable: ["search"] }) as { id: string; output: unknown }[]
    expect(out.find((m) => m.id === "s1")!.output).toContain("[tool result cleared: search")
    expect(out.find((m) => m.id === "w1")!.output).toBe("result-w1")
    expect(out.find((m) => m.id === "s2")!.output).toBe("result-s2")
    expect(out.find((m) => m.id === "s3")!.output).toBe("result-s3")
    // clearErrors flips the error retention explicitly.
    const aggressive = clearStaleToolResults(messages, { keepRecent: 1, thresholdChars: 1, visibleChars: 9_000, clearErrors: true }) as { id: string; output: unknown }[]
    expect(aggressive.find((m) => m.id === "s2")!.output).toContain("[tool result cleared")
  })
})

describe("wave-10 compact hooks", () => {
  function makeSeeded(): { runtime: TurnRuntime; resolveTool: (n: string) => Tool | undefined } {
    const events = new MemoryEventStore()
    const inbox = new MemorySessionInput(events)
    let round = 0
    const runtime: TurnRuntime = { events, inbox, llm: { id: "t", stream: async () => {
      round += 1
      return round === 1
        ? eventsOf([{ type: "tool-call", id: "c1", name: "search", input: {} }, { type: "step-finish", finish: "tool" }])
        : eventsOf([{ type: "text.delta", text: "done" }, { type: "step-finish", finish: "stop" }])
    } } }
    const map = new Map([["search", { name: "search", execute: async () => "ok" } as Tool]])
    return { runtime, resolveTool: (n) => map.get(n) }
  }

  async function seedBig(runtime: TurnRuntime): Promise<void> {
    await runtime.events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    for (let i = 0; i < 14; i++) await runtime.events.append("s1", "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: `a${i}`, seq: 0, content: [{ type: "text", text: `reply ${i}` }] } })
    await runtime.inbox.admit({ id: "m1", sessionId: "s1", prompt: "hi", delivery: "steer" })
  }

  it("a pre-compact hook BLOCK skips the automatic fold", async () => {
    const { runtime, resolveTool } = makeSeeded()
    await seedBig(runtime)
    const calls: string[] = []
    const result = await runSession(runtime, {
      agent, sessionId: "s1", resolveTool,
      compactThreshold: 10, // tiny limit → the trigger wants to fire every round
      runHooks: async (event) => {
        calls.push(event)
        return event === "pre-compact" ? { decision: "block", reason: "hold" } : { decision: "allow" }
      },
    })
    expect(result.finish).toBe("stop")
    expect(calls.filter((c) => c === "pre-compact")).toHaveLength(1)
    const log = await runtime.events.read("s1")
    expect(log.filter((e) => e.type === "Session.Compacted")).toHaveLength(0)
  })

  it("the reactive overflow fold IGNORES a pre-compact block (protection is not optional)", async () => {
    const { runtime, resolveTool } = makeSeeded()
    await seedBig(runtime)
    const err = new Error("context length exceeded")
    ;(err as Error & { code?: string }).code = "context-overflow"
    ;(err as Error & { _tag?: string })._tag = "LlmHttpError"
    let call = 0
    const runtime2 = { ...runtime, llm: { id: "t", stream: async () => {
      call += 1
      if (call === 1) throw err
      return eventsOf([{ type: "text.delta", text: "recovered" }, { type: "step-finish", finish: "stop" }])
    } } } as TurnRuntime
    const result = await runSession(runtime2, {
      agent, sessionId: "s1", resolveTool,
      compactThreshold: 10,
      runHooks: async () => ({ decision: "block", reason: "no compaction ever" }),
    })
    expect(result.finish).toBe("stop")
    const log = await runtime.events.read("s1")
    expect(log.filter((e) => e.type === "Session.Compacted")).toHaveLength(1)
  })
})


describe("post-tool-use hook (wave 8 hooks surface)", () => {
  it("fires once per settled tool result with callId and error flag", async () => {
    const events = new MemoryEventStore()
    const inbox = new MemorySessionInput(events)
    const search: Tool = { name: "search", execute: async () => "ok" }
    const boom: Tool = { name: "boom", execute: async () => { throw new Error("kaput") } }
    const map = new Map([["search", search], ["boom", boom]])
    let round = 0
    const runtime: TurnRuntime = { events, inbox, llm: { id: "t", stream: async () => {
      round += 1
      return round === 1
        ? eventsOf([
            { type: "tool-call", id: "c1", name: "search", input: {} },
            { type: "tool-call", id: "c2", name: "boom", input: {} },
            { type: "step-finish", finish: "tool" },
          ])
        : eventsOf([{ type: "text.delta", text: "done" }, { type: "step-finish", finish: "stop" }])
    } } }
    await runtime.events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    await runtime.inbox.admit({ id: "m1", sessionId: "s1", prompt: "hi", delivery: "steer" })

    const fired: { name?: string; callId?: string; isError?: boolean }[] = []
    await runSession(runtime, {
      agent, sessionId: "s1", resolveTool: (n) => map.get(n),
      runHooks: async (event, input) => {
        if (event === "post-tool-use") fired.push(input as { name?: string; callId?: string; isError?: boolean })
        return { decision: "allow" }
      },
    })
    expect(fired).toHaveLength(2)
    expect(fired.find((f) => f.callId === "c1")).toMatchObject({ name: "search", isError: false })
    expect(fired.find((f) => f.callId === "c2")).toMatchObject({ name: "boom", isError: true })
  })
})
