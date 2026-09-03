import { describe, expect, it } from "bun:test"
import { MemoryEventStore } from "../session/store"
import { MemorySessionInput } from "../session/input"
import { Session } from "../session/session"
import { runSession } from "./loop"
import type { TurnRuntime, Agent, Tool } from "./runner"
import type { LLMEvent, LLMRequest } from "@newhorse/schema"

function makeRuntime(llm: TurnRuntime["llm"], tools: Tool[] = []): { runtime: TurnRuntime; resolveTool: (n: string) => Tool | undefined } {
  const events = new MemoryEventStore()
  const inbox = new MemorySessionInput(events)
  const map = new Map(tools.map((t) => [t.name, t]))
  return { runtime: { events, inbox, llm }, resolveTool: (n) => map.get(n) }
}

const agent: Agent = { id: "wave7", model: "test-model" }

function eventsOf(events: LLMEvent[]): AsyncIterable<LLMEvent> {
  return (async function* () {
    for (const e of events) yield e
  })()
}

function multiRoundLLM(rounds: LLMEvent[][]): { llm: TurnRuntime["llm"]; requests: LLMRequest[] } {
  const requests: LLMRequest[] = []
  let call = 0
  const llm: TurnRuntime["llm"] = {
    id: "t",
    stream: async (req) => {
      requests.push(req)
      const events = rounds[call] ?? rounds[rounds.length - 1]!
      call += 1
      return eventsOf(events)
    },
  }
  return { llm, requests }
}

const toolRound = (id: string): LLMEvent[] => [
  { type: "tool-call", id, name: "search", input: { q: id } },
  { type: "step-finish", finish: "tool" },
]
const stopRound = (text: string): LLMEvent[] => [{ type: "text.delta", text }, { type: "step-finish", finish: "stop" }]

async function seedSession(runtime: TurnRuntime, id = "s1"): Promise<void> {
  await runtime.events.append(id, "Session.Created", { id, location: "/proj", createdAt: 1 })
  await runtime.inbox.admit({ id: `m-${id}`, sessionId: id, prompt: "hi", delivery: "steer" })
}

describe("wave-7 context management", () => {
  it("truncates an oversized tool result: head+tail excerpt with a marker; the run still completes", async () => {
    const big = "x".repeat(50_000)
    const search: Tool = { name: "search", execute: async () => big }
    const { llm } = multiRoundLLM([toolRound("call_1"), stopRound("done")])
    const { runtime, resolveTool } = makeRuntime(llm, [search])
    await seedSession(runtime)

    const result = await runSession(runtime, { agent, sessionId: "s1", resolveTool, toolOutputMaxChars: 1_000 })
    expect(result.finish).toBe("stop")

    const session = Session.replay(await runtime.events.read("s1"))
    const tool = session.messages.find((m) => m.kind === "tool") as unknown as { output: string }
    expect(tool.output.length).toBeLessThanOrEqual(1_100)
    expect(tool.output).toContain("[...truncated ")
    expect(tool.output.startsWith("x")).toBe(true)
    expect(tool.output.endsWith("x")).toBe(true)
  })

  it("truncation tolerates undefined and object outputs (shapes the pipeline always allowed)", async () => {
    const noop: Tool = { name: "noop", execute: async () => undefined }
    const big: Tool = { name: "big", execute: async () => ({ blob: "y".repeat(40_000) }) }
    const { llm } = multiRoundLLM([
      [
        { type: "tool-call", id: "c1", name: "noop", input: {} },
        { type: "tool-call", id: "c2", name: "big", input: {} },
        { type: "step-finish", finish: "tool" },
      ],
      stopRound("done"),
    ])
    const { runtime, resolveTool } = makeRuntime(llm, [noop, big])
    await seedSession(runtime)

    const result = await runSession(runtime, { agent, sessionId: "s1", resolveTool, toolOutputMaxChars: 1_000 })
    expect(result.finish).toBe("stop")

    const session = Session.replay(await runtime.events.read("s1"))
    const tools = session.messages.filter((m) => m.kind === "tool") as unknown as { callId: string; output: unknown }[]
    expect(tools).toHaveLength(2)
    // undefined passes through untouched (the pre-wave pipeline tolerated it).
    expect(tools.find((t) => t.callId === "c1")!.output).toBeUndefined()
    // An oversized object becomes a truncated string excerpt.
    const bigOut = tools.find((t) => t.callId === "c2")!.output as string
    expect(typeof bigOut).toBe("string")
    expect(bigOut).toContain("[...truncated ")
    expect(bigOut.length).toBeLessThanOrEqual(1_100)
  })

  it("compaction breaker: a fold that leaves the view over the limit fires ONCE, not every round", async () => {
    const giant = "g".repeat(300_000)
    const search: Tool = { name: "search", execute: async () => "ok" }
    const { llm } = multiRoundLLM([toolRound("c1"), toolRound("c2"), stopRound("done")])
    const { runtime, resolveTool } = makeRuntime(llm, [search])
    await runtime.events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    // compactSession folds MessageAppended history: a small assistant message
    // then a giant one. The giant lands in the retained tail ("always at
    // least one message"), so no fold can shrink the visible view back under
    // the limit — the breaker must stop the re-firing instead of burning a
    // summarize call every round.
    await runtime.events.append("s1", "Session.Prompted", { id: "p1", sessionId: "s1", prompt: "normal", delivery: "steer", principal: "user", promotedSeq: 0 })
    await runtime.events.append("s1", "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: "a1", seq: 0, content: [{ type: "text", text: "small reply" }] } })
    await runtime.events.append("s1", "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: "a2", seq: 0, content: [{ type: "text", text: giant }] } })

    const result = await runSession(runtime, { agent, sessionId: "s1", resolveTool })
    const log = await runtime.events.read("s1")
    expect(log.filter((e) => e.type === "Session.Compacted")).toHaveLength(1)
    // The run still finished honestly (registry settles primary sessions via
    // StepEnded, not a Settled event — that one is child-session-only).
    expect(result.finish).toBe("stop")
    expect(log.filter((e) => e.type === "Session.StepEnded")).toHaveLength(3)
  })

  it("microcompact projection clears old tool results once over the trigger, keeping the newest", async () => {
    let n = 0
    const search: Tool = { name: "search", execute: async () => `result-${++n}` }
    const threeCalls = (a: string, b: string, c: string): LLMEvent[] => [
      { type: "tool-call", id: a, name: "search", input: { q: a } },
      { type: "tool-call", id: b, name: "search", input: { q: b } },
      { type: "tool-call", id: c, name: "search", input: { q: c } },
      { type: "step-finish", finish: "tool" },
    ]
    const { llm, requests } = multiRoundLLM([threeCalls("c1a", "c1b", "c1c"), threeCalls("c2a", "c2b", "c2c"), stopRound("done")])
    const { runtime, resolveTool } = makeRuntime(llm, [search])
    await seedSession(runtime)

    await runSession(runtime, { agent, sessionId: "s1", resolveTool, compactThreshold: 100, compactAuto: false, toolResultKeepRecent: 2 })
    const last = JSON.stringify(requests.at(-1)!)
    // The four oldest results are placeholders; the newest two survive verbatim.
    expect(last.match(/\[tool result cleared: search/g)).toHaveLength(4)
    expect(last).toContain("result-5")
    expect(last).toContain("result-6")
    expect(last).not.toContain('result-1"')
  })

  it("reactive compaction: a provider context-overflow folds and retries the step once", async () => {
    let call = 0
    const llm: TurnRuntime["llm"] = {
      id: "t",
      stream: async () => {
        call += 1
        if (call === 1) {
          const err = new Error("This model's maximum context length is exceeded")
          ;(err as Error & { code?: string }).code = "context-overflow"
          ;(err as Error & { _tag?: string })._tag = "LlmHttpError"
          throw err
        }
        return eventsOf(stopRound("recovered"))
      },
    }
    const { runtime, resolveTool } = makeRuntime(llm)
    await runtime.events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    // Six assistant messages so the reactive fold (retain 4) has a head to fold.
    for (let i = 0; i < 6; i++) await runtime.events.append("s1", "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: `a${i}`, seq: 0, content: [{ type: "text", text: `reply ${i}` }] } })

    const result = await runSession(runtime, { agent, sessionId: "s1", resolveTool })
    expect(result.finish).toBe("stop")
    const log = await runtime.events.read("s1")
    expect(log.filter((e) => e.type === "Session.Compacted")).toHaveLength(1)
  })

  it("reactive compaction gives up honestly on a second overflow", async () => {
    const err = new Error("context length exceeded")
    ;(err as Error & { code?: string }).code = "context-overflow"
    ;(err as Error & { _tag?: string })._tag = "LlmHttpError"
    const llm: TurnRuntime["llm"] = { id: "t", stream: async () => { throw err } }
    const { runtime, resolveTool } = makeRuntime(llm)
    await runtime.events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    for (let i = 0; i < 6; i++) await runtime.events.append("s1", "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: `a${i}`, seq: 0, content: [{ type: "text", text: `reply ${i}` }] } })

    await expect(runSession(runtime, { agent, sessionId: "s1", resolveTool })).rejects.toThrow()
    const log = await runtime.events.read("s1")
    expect(log.filter((e) => e.type === "Session.Compacted")).toHaveLength(1)
  })

  it("goal budget emits a one-time 80% in-band warning (the log is the de-dup store)", async () => {
    const { llm } = multiRoundLLM([toolRound("c1"), stopRound("done")])
    const { runtime, resolveTool } = makeRuntime(llm)
    await runtime.events.append("s1", "Session.Created", { id: "s1", location: "/proj", createdAt: 1 })
    await runtime.events.append("s1", "Session.GoalUpdated", { sessionId: "s1", objective: "ship it", status: "active", tokenBudget: 1_000, ts: 1 })
    await runtime.events.append("s1", "Session.StepEnded", { sessionId: "s1", step: 1, finish: "stop", usage: { inputTokens: 850, outputTokens: 0 } })

    await runSession(runtime, { agent, sessionId: "s1", resolveTool })
    const log = await runtime.events.read("s1")
    const warns = log.filter((e) => e.type === "Session.PromptAdmitted" && typeof (e.data as { prompt?: string }).prompt === "string" && ((e.data as { prompt?: string }).prompt!).startsWith("[goal budget] 80%"))
    expect(warns).toHaveLength(1)
    // Not the hard stop — the goal stays active, the run completes normally.
    expect(log.some((e) => e.type === "Session.GoalUpdated" && (e.data as { status?: string }).status === "blocked")).toBe(false)
  })
})
