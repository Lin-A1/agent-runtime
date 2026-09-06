import { describe, expect, it } from "bun:test"
import { foldTranscript } from "./fold"
import type { StoredEventRow } from "./types"

function ev(seq: number, type: string, data: Record<string, unknown>): StoredEventRow {
  return { seq, type, data }
}

describe("foldTranscript", () => {
  it("does not drop items when no truncation event is present", () => {
    const events = [
      ev(0, "Session.Created", { id: "s1", location: "/w", createdAt: 1 }),
      ev(1, "Session.Prompted", { id: "p1", prompt: "hello", delivery: "steer", principal: "user" }),
      ev(2, "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: "a1", seq: 2, content: [{ type: "text", text: "hi there" }] } }),
    ]
    const items = foldTranscript(events)
    expect(items.filter((it) => it.kind === "user").length).toBe(1)
    const user = items.find((it) => it.kind === "user")
    expect(user && "text" in user ? user.text : "").toBe("hello")
  })

  it("drops user turns at/beyond the truncated boundary", () => {
    const events = [
      ev(0, "Session.Created", { id: "s1", location: "/w", createdAt: 1 }),
      ev(1, "Session.Prompted", { id: "p1", prompt: "first", delivery: "steer", principal: "user" }),
      ev(2, "Session.MessageAppended", { sessionId: "s1", message: { kind: "assistant", id: "a1", seq: 2, content: [{ type: "text", text: "first reply" }] } }),
      ev(3, "Session.Prompted", { id: "p2", prompt: "second", delivery: "steer", principal: "user" }),
      // Rewind to seq 1: drop everything from turn 2 onward.
      ev(4, "Session.Truncated", { sessionId: "s1", atSeq: 1, by: "host", ts: Date.now() }),
    ]
    const items = foldTranscript(events)
    const userItems = items.filter((it) => it.kind === "user")
    expect(userItems.length).toBe(1)
    const user = userItems[0]
    expect(user && "text" in user ? user.text : "").toBe("first")
  })
})
