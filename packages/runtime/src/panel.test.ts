import { describe, expect, it } from "bun:test"
import type { Fetcher } from "@newhorse/llm"
import type { LoopEvent } from "@newhorse/core"
import { createApp } from "./app"

function sse(payload: string): Response {
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } })
}

/** turn1 = tool call to "stub", turn2 = final text. */
const toolWire = (name: string, args: string): Array<string> => [
  "data: " + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name, arguments: args } }] }, finish_reason: "tool_calls" }] }) + "\n\n",
  "data: [DONE]\n\n",
]
const textWire = (text: string): string => ["data: " + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] }) + "\n\n", "data: [DONE]\n\n"].join("")

describe("panel output layer (Session.PanelPosted)", () => {
  it("a tool declaring presents derives a durable panel + a live panel LoopEvent", async () => {
    let call = 0
    const fetch: Fetcher = async () => sse(call++ === 0 ? toolWire("stub", "{}").join("") : textWire("shown"))
    const emitted: LoopEvent[] = []
    const app = await createApp({
      provider: { kind: "openai", baseUrl: "https://api.example.com", apiKey: "k" },
      model: "m",
      workspace: "/proj",
      tools: [{
        name: "stub",
        sideEffects: false,
        execute: async () => ({ rows: [1, 2] }),
        presents: {
          kind: "table",
          title: () => "stub table",
          toPanel: (_input: unknown, output: unknown) => ({ rows: (output as { rows: number[] }).rows }),
        },
      }],
      fetch: fetch as never,
    })
    app.onEvent((e) => emitted.push(e))
    await app.prompt("show me")

    // Durable: Session.PanelPosted appended with the mapped payload.
    const log = await app.events.read(app.sessionId)
    const posted = log.filter((e) => e.type === "Session.PanelPosted")
    expect(posted.length).toBe(1)
    const d = posted[0]!.data as { kind: string; title: string; payload: { rows: number[] } }
    expect(d.kind).toBe("table")
    expect(d.title).toBe("stub table")
    expect(d.payload.rows).toEqual([1, 2])
    // Live: a panel LoopEvent reached onEvent with the same payload.
    const live = emitted.find((e) => e.type === "panel")
    expect(live?.type).toBe("panel")
    expect((live as Extract<LoopEvent, { type: "panel" }>).payload).toEqual({ rows: [1, 2] })
  })

  it("a failed tool result never presents, and a tool without presents derives nothing", async () => {
    // Turn 1: the FAILING tool runs (isError result → no panel). Turn 2: the
    // plain tool (no presents → no panel).
    const wires = [toolWire("boom", "{}").join(""), textWire("ok"), toolWire("plain", "{}").join(""), textWire("ok")]
    let call = 0
    const fetch: Fetcher = async () => sse(wires[Math.min(call++, wires.length - 1)]!)

    const app = await createApp({
      provider: { kind: "openai", baseUrl: "https://api.example.com", apiKey: "k" },
      model: "m",
      workspace: "/proj",
      tools: [
        { name: "boom", execute: async () => { throw new Error("explode") }, presents: { kind: "table", toPanel: () => ({ x: 1 }) } },
        { name: "plain", execute: async () => ({ fine: true }) },
      ],
      fetch: fetch as never,
    })
    await app.prompt("go")
    await app.prompt("go again")
    const log = await app.events.read(app.sessionId)
    expect(log.filter((e) => e.type === "Session.PanelPosted").length).toBe(0)
  })
})
