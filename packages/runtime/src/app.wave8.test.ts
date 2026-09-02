import { describe, expect, it } from "bun:test"
import { createApp } from "./app"
import type { Fetcher } from "@newhorse/llm"
import type { LLMEvent } from "@newhorse/schema"

function sse(payload: string): Response {
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } })
}

const DONE = "data: [DONE]\n\n"

function textFrame(text: string): string {
  return "data: " + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] }) + "\n\n"
}

describe("task replacement + hooks (wave 8)", () => {
  it("replace:true aborts the live run and the new prompt takes over", async () => {
    const enc = new TextEncoder()
    let call = 0
    const fetch: Fetcher = async () => {
      call += 1
      if (call === 1) {
        // A HANGING provider stream: no [DONE] for 5s — only replace (abort)
        // can end this turn early. The late timer's enqueue is guarded: the
        // replace-abort tears this stream down long before the timer fires.
        const body = new ReadableStream({
          start(controller) {
            setTimeout(() => {
              try {
                controller.enqueue(enc.encode(textFrame("late")))
                controller.enqueue(enc.encode(DONE))
                controller.close()
              } catch {
                // the replace-abort already tore this stream down — the timer
                // outlives the test and must not surface as an unhandled error
              }
            }, 5_000)
          },
        })
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
      }
      return sse(textFrame("replaced ok") + DONE)
    }
    const app = await createApp({ provider: { kind: "openai", baseUrl: "https://x", apiKey: "k" }, model: "m", sessionId: "replace-1", fetch: fetch as never })

    const startedAt = Date.now()
    const first = app.prompt("long task") // in flight, hanging
    // Wait until the drain is actually inside the provider stream (isBusy is
    // raised synchronously at prompt entry, BEFORE `current` is assigned —
    // replacing in that window would no-op into the bounded wait).
    await new Promise((r) => setTimeout(r, 200))
    // The REAL replace path: abort the live run, bounded wait, takeover.
    const second = await app.prompt("new task", "user", undefined, { replace: true })
    const elapsed = Date.now() - startedAt
    await first
    expect(second.finish).toBe("stop")
    expect(elapsed).toBeLessThan(900) // the hang was cut short by the abort
    const log = await app.events.read("replace-1")
    expect(log.some((e) => e.type === "Session.Interrupted")).toBe(true)
  })

  it("ApprovedForSession: an approved command re-runs without re-prompting", async () => {
    // Round 1 runs the command (prompts → approved); round 2 runs the IDENTICAL
    // command — served from the session memory (exactly ONE approval total).
    const bashSse = "data: " + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "bash", arguments: JSON.stringify({ command: "echo wave8-session" }) } }] }, finish_reason: "tool_calls" }] }) + "\n\n" + "data: [DONE]\n\n"
    let round = 0
    const fetch: Fetcher = async () => {
      round += 1
      return round <= 2 ? sse(bashSse) : sse(textFrame("done") + DONE)
    }
    let approvals = 0
    const app = await createApp({
      provider: { kind: "openai", baseUrl: "https://x", apiKey: "k" },
      model: "m",
      sessionId: "approve-1",
      enableBash: true,
      fetch: fetch as never,
      execRules: [{ type: "prefix_rule", pattern: ["echo"], decision: "prompt", reason: "test gate" }],
      onApprove: async () => {
        approvals += 1
        return true
      },
    })
    await app.prompt("run it", "user")
    await app.prompt("run it again", "user")
    expect(approvals).toBe(1)
    const log = await app.events.read("approve-1")
    const toolResults = log.filter((e) => e.type === "Session.MessageAppended" && (e.data as { message?: { kind?: string } }).message?.kind === "tool")
    expect(toolResults).toHaveLength(2)
  })

  it("user-prompt-submit hook BLOCK denies the prompt pre-admission", async () => {
    const fetch: Fetcher = async () => sse(textFrame("ok") + DONE)
    const registry = {
      list: (kind: string) =>
        kind === "hook"
          ? [{ kind: "hook", name: "deny-all", event: "user-prompt-submit", run: async () => ({ decision: "block", reason: "not allowed" }) }]
          : [],
    }
    const app = await createApp({ provider: { kind: "openai", baseUrl: "https://x", apiKey: "k" }, model: "m", sessionId: "hook-deny", plugins: registry as never, fetch: fetch as never })
    await expect(app.prompt("should be denied")).rejects.toThrow(/denied by hook/)
    const log = await app.events.read("hook-deny")
    expect(log.some((e) => e.type === "Session.PromptAdmitted")).toBe(false)
  })
})
