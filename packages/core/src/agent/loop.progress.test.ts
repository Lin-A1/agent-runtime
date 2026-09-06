import { describe, expect, it } from "bun:test"
import { MemoryEventStore } from "../session/store"
import { MemorySessionInput } from "../session/input"
import { runSession } from "./loop"
import type { ToolCtx, TurnRuntime, Agent, Tool } from "./runner"
import type { LLMEvent, LLMRequest } from "@newhorse/schema"

/** Tool-progress seam: a streaming tool's ctx.onProgress chunks ride the live
 *  event stream as tool-progress frames (bash stdout lives on this). */

const agent: Agent = { id: "progress", model: "test-model" }

function makeRuntime(llm: TurnRuntime["llm"]): TurnRuntime {
  const events = new MemoryEventStore()
  const inbox = new MemorySessionInput(events)
  return { events, inbox, llm }
}

async function seedSession(runtime: TurnRuntime, id = "s1"): Promise<void> {
  await runtime.events.append(id, "Session.Created", { id, location: "/proj", createdAt: 1 })
  await runtime.inbox.admit({ id: `m-${id}`, sessionId: id, prompt: "hi", delivery: "steer" })
}

describe("tool-progress seam", () => {
  it("forwards ctx.onProgress chunks as live tool-progress events, then the result", async () => {
    const watcher: Tool = {
      name: "watcher",
      inputSchema: { type: "object" },
      execute: async (_input: unknown, ctx?: ToolCtx) => {
        ctx?.onProgress?.("step 1 done\n")
        ctx?.onProgress?.("step 2 done\n")
        return "all done"
      },
    }

    let calls = 0
    const llm: TurnRuntime["llm"] = {
      id: "t",
      stream: async (_req: LLMRequest) => {
        calls += 1
        return (async function* (): AsyncGenerator<LLMEvent> {
          if (calls === 1) {
            yield { type: "tool-call", id: "call_1", name: "watcher", input: {} }
            yield { type: "step-finish", finish: "tool" }
          } else {
            yield { type: "text.delta", text: "done" }
            yield { type: "step-finish", finish: "stop" }
          }
        })()
      },
    }
    const runtime = makeRuntime(llm)
    await seedSession(runtime)

    const events: Array<{ type: string; text?: string }> = []
    await runSession(runtime, {
      agent,
      sessionId: "s1",
      resolveTool: (name) => (name === "watcher" ? watcher : undefined),
      onEvent: (ev) => events.push({ type: ev.type, ...(ev as { text?: string }).text !== undefined ? { text: (ev as { text?: string }).text } : {} }),
    })

    const progress = events.filter((e) => e.type === "tool-progress")
    expect(progress).toHaveLength(2)
    expect(progress[0]!.text).toBe("step 1 done\n")
    expect(progress[1]!.text).toBe("step 2 done\n")
    // The result frame still lands after the progress frames.
    const lastProgress = events.findIndex((e) => e.type === "tool-progress")
    const result = events.findIndex((e) => e.type === "tool-result")
    expect(lastProgress).toBeGreaterThan(-1)
    expect(result).toBeGreaterThan(lastProgress)
  })
})
