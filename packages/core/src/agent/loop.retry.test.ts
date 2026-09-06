import { describe, expect, it } from "bun:test"
import { MemoryEventStore } from "../session/store"
import { MemorySessionInput } from "../session/input"
import { runSession } from "./loop"
import type { TurnRuntime, Agent } from "./runner"
import type { LLMEvent, LLMRequest } from "@newhorse/schema"

/** Zero-output transport retries: a connect/first-byte drop must not kill a
 *  long-horizon turn. One retry per drain; a drop after output stays honest. */

const agent: Agent = { id: "retry", model: "test-model" }

function makeRuntime(llm: TurnRuntime["llm"]): TurnRuntime {
  const events = new MemoryEventStore()
  const inbox = new MemorySessionInput(events)
  return { events, inbox, llm }
}

const stopRound = (text: string): LLMEvent[] => [{ type: "text.delta", text }, { type: "step-finish", finish: "stop" }]

async function seedSession(runtime: TurnRuntime, id = "s1"): Promise<void> {
  await runtime.events.append(id, "Session.Created", { id, location: "/proj", createdAt: 1 })
  await runtime.inbox.admit({ id: `m-${id}`, sessionId: id, prompt: "hi", delivery: "steer" })
}

describe("zero-output transport retry", () => {
  it("retries a connect-phase drop once and completes; the log holds exactly one assistant message", async () => {
    let calls = 0
    const llm: TurnRuntime["llm"] = {
      id: "t",
      stream: async (_req: LLMRequest) => {
        calls += 1
        if (calls === 1) throw new Error("fetch failed: connect ECONNRESET")
        return (async function* () {
          for (const e of stopRound("ok")) yield e
        })()
      },
    }
    const runtime = makeRuntime(llm)
    await seedSession(runtime)

    const result = await runSession(runtime, { agent, sessionId: "s1", resolveTool: () => undefined })
    expect(result.finish).toBe("stop")
    const log = await runtime.events.read("s1")
    expect(log.filter((e) => e.type === "Session.MessageAppended" && (e.data?.message as { kind?: string })?.kind === "assistant")).toHaveLength(1)
  })

  it("retries a mid-stream drop before any output; no partial message is logged", async () => {
    let calls = 0
    const llm: TurnRuntime["llm"] = {
      id: "t",
      stream: async () => {
        calls += 1
        if (calls === 1) {
          // First-byte drop: the stream opens but dies before any event.
          return (async function* () {
            throw new Error("socket hang up")
          })()
        }
        return (async function* () {
          for (const e of stopRound("recovered")) yield e
        })()
      },
    }
    const runtime = makeRuntime(llm)
    await seedSession(runtime)

    const result = await runSession(runtime, { agent, sessionId: "s1", resolveTool: () => undefined })
    expect(result.finish).toBe("stop")
    const log = await runtime.events.read("s1")
    const assistants = log.filter((e) => e.type === "Session.MessageAppended" && (e.data?.message as { kind?: string })?.kind === "assistant")
    expect(assistants).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it("a drop AFTER output stays an honest error (partial message flushed, no retry)", async () => {
    let calls = 0
    const llm: TurnRuntime["llm"] = {
      id: "t",
      stream: async () => {
        calls += 1
        return (async function* () {
          yield { type: "text.delta", text: "partial" }
          throw new Error("read ECONNRESET")
        })()
      },
    }
    const runtime = makeRuntime(llm)
    await seedSession(runtime)

    expect(runSession(runtime, { agent, sessionId: "s1", resolveTool: () => undefined })).rejects.toThrow("read ECONNRESET")
    const log = await runtime.events.read("s1")
    const assistants = log.filter((e) => e.type === "Session.MessageAppended" && (e.data?.message as { kind?: string })?.kind === "assistant")
    expect(assistants).toHaveLength(1)
    expect(calls).toBe(1)
  })
})
