import { describe, expect, it } from "bun:test"
import { MemoryEventStore } from "./store"
import { SessionRegistry, fold } from "./registry"
import type { StoredEvent } from "@newhorse/schema"

const created = (id: string, location: string, createdAt = Date.now()): StoredEvent => ({
  aggregate: "session",
  aggregate_id: id,
  seq: 0,
  type: "Session.Created",
  data: { id, location, createdAt },
})

describe("session registry", () => {
  it("folds a session's events into a row", () => {
    const row = fold([
      created("s1", "/proj"),
      { aggregate: "session", aggregate_id: "s1", seq: 1, type: "Session.StepEnded", data: { sessionId: "s1", step: 1, finish: "stop" } },
    ])
    expect(row?.sessionId).toBe("s1")
    expect(row?.workspace).toBe("/proj")
    expect(row?.status).toBe("settled")
    expect(row?.createdAt).toBeGreaterThan(0)
  })

  it("tracks interrupted status", () => {
    const row = fold([
      created("s1", "/proj"),
      { aggregate: "session", aggregate_id: "s1", seq: 1, type: "Session.Interrupted", data: { sessionId: "s1" } },
    ])
    expect(row?.status).toBe("interrupted")
  })

  it("folds the fixed role from Session.Created (butler); ordinary sessions have none", () => {
    const row = fold([
      { aggregate: "session", aggregate_id: "b1", seq: 0, type: "Session.Created", data: { id: "b1", location: "/w", createdAt: 1, role: "butler" } },
    ])
    expect(row?.role).toBe("butler")
    const plain = fold([created("s9", "/w")])
    expect(plain?.role).toBeUndefined()
  })

  it("derives the title from the first admitted prompt (user words), not the assistant reply", () => {
    const row = fold([
      created("s1", "/proj"),
      { aggregate: "session", aggregate_id: "s1", seq: 1, type: "Session.PromptAdmitted", data: { id: "p1", sessionId: "s1", prompt: "帮我总结这个仓库的结构", delivery: "normal", principal: { kind: "user" }, admittedSeq: 1 } },
      { aggregate: "session", aggregate_id: "s1", seq: 2, type: "Session.MessageAppended", data: { message: { kind: "assistant", content: [{ type: "text", text: "好的，我先读一下代码……" }] } } },
    ])
    expect(row?.title).toBe("帮我总结这个仓库的结构")
  })

  it("Session.Prompted also seeds the title; Session.TitleSet always wins", () => {
    const prompted = fold([
      created("s1", "/proj"),
      { aggregate: "session", aggregate_id: "s1", seq: 1, type: "Session.Prompted", data: { id: "p1", sessionId: "s1", prompt: "写一个周报草稿", delivery: "normal", principal: { kind: "user" }, promotedSeq: 1 } },
    ])
    expect(prompted?.title).toBe("写一个周报草稿")

    const explicit = fold([
      created("s2", "/proj"),
      { aggregate: "session", aggregate_id: "s2", seq: 1, type: "Session.PromptAdmitted", data: { id: "p1", sessionId: "s2", prompt: "原始提示词", delivery: "normal", principal: { kind: "user" }, admittedSeq: 1 } },
      { aggregate: "session", aggregate_id: "s2", seq: 2, type: "Session.TitleSet", data: { title: "手动标题" } },
      // a later prompt must not clobber the explicit title either
      { aggregate: "session", aggregate_id: "s2", seq: 3, type: "Session.PromptAdmitted", data: { id: "p2", sessionId: "s2", prompt: "第二个提示词", delivery: "normal", principal: { kind: "user" }, admittedSeq: 3 } },
    ])
    expect(explicit?.title).toBe("手动标题")
  })

  it("lists sessions filtered by workspace and status (lazy hydration)", async () => {
    const events = new MemoryEventStore()
    await events.append("s1", "Session.Created", { id: "s1", location: "/a", createdAt: 1 })
    await events.append("s1", "Session.StepEnded", { sessionId: "s1", step: 1, finish: "stop" })
    await events.append("s2", "Session.Created", { id: "s2", location: "/b", createdAt: 2 })

    const registry = new SessionRegistry(events)
    const all = await registry.list()
    expect(all.length).toBe(2)

    const inA = await registry.list({ workspace: "/a" })
    expect(inA.length).toBe(1)
    expect(inA[0]?.sessionId).toBe("s1")

    const settled = await registry.list({ status: "settled" })
    expect(settled.length).toBe(1)
    expect(settled[0]?.sessionId).toBe("s1")
  })

  it("gets a single session and returns undefined when unknown", async () => {
    const events = new MemoryEventStore()
    await events.append("s1", "Session.Created", { id: "s1", location: "/a", createdAt: 1 })
    const registry = new SessionRegistry(events)
    expect((await registry.get("s1"))?.sessionId).toBe("s1")
    expect(await registry.get("nope")).toBeUndefined()
  })

  it("refresh() picks up events appended after the index was hydrated (no dead index)", async () => {
    const events = new MemoryEventStore()
    await events.append("s1", "Session.Created", { id: "s1", location: "/a", createdAt: 1 })
    const registry = new SessionRegistry(events)

    // First read hydrates the index as "created"/"active".
    expect((await registry.get("s1"))?.status).toBe("created")

    // A later interrupt is appended after hydration — a new app/run path.
    await events.append("s1", "Session.Interrupted", { sessionId: "s1" })
    await registry.refresh()
    expect((await registry.get("s1"))?.status).toBe("interrupted")
  })

  it("fold records parentId from Session.Spawned", async () => {
    const events = new MemoryEventStore()
    await events.append("s1", "Session.Created", { id: "s1", location: "/a", createdAt: 1 })
    await events.append("s1", "Session.Spawned", { sessionId: "s1", parentId: "p1" })
    const registry = new SessionRegistry(events)
    expect((await registry.get("s1"))?.parentId).toBe("p1")
  })

  it("audit() folds butler actions from the audit aggregate", async () => {
    const events = new MemoryEventStore()
    await events.append("audit:b1", "Session.ButlerAction", { sessionId: "b1", actorKind: "butler", actorId: "b1", op: "send_to_session", targetSessionId: "s1", outcome: "denied", reason: "butler requires explicit user authorization", ts: 100 })
    await events.append("audit:b1", "Session.ButlerAction", { sessionId: "b1", actorKind: "parent", actorId: "p1", op: "send_to_session", targetSessionId: "s1", outcome: "allowed", ts: 200 })
    const registry = new SessionRegistry(events)
    const rows = await registry.audit("b1")
    expect(rows.length).toBe(2)
    expect(rows[0]?.outcome).toBe("allowed") // newest first
    expect(rows[1]?.reason).toContain("butler requires")
  })

  it("origin folds from Session.Spawned.via; parentId/excludeChildren query filters", async () => {
    const spawned = (id: string, parentId: string, via: "dag" | "spawn"): StoredEvent => ({
      aggregate: "session",
      aggregate_id: id,
      seq: 1,
      type: "Session.Spawned",
      data: { sessionId: id, parentId, via },
    })
    const events = new MemoryEventStore()
    await events.append("parent-1", "Session.Created", { id: "parent-1", location: "/proj", createdAt: Date.now() })
    await events.append("child-dag", "Session.Created", { id: "child-dag", location: "/proj", createdAt: Date.now() })
    await events.append("child-dag", "Session.Spawned", { sessionId: "child-dag", parentId: "parent-1", via: "dag" })
    await events.append("child-spawn", "Session.Created", { id: "child-spawn", location: "/proj", createdAt: Date.now() })
    await events.append("child-spawn", "Session.Spawned", { sessionId: "child-spawn", parentId: "parent-1", via: "spawn" })
    await events.append("free", "Session.Created", { id: "free", location: "/proj", createdAt: Date.now() })
    const registry = new SessionRegistry(events)
    // Fold: origin comes from the Spawned event's via field.
    const dagRow = await registry.get("child-dag")
    expect(dagRow?.parentId).toBe("parent-1")
    expect(dagRow?.origin).toBe("dag")
    const spawnRow = await registry.get("child-spawn")
    expect(spawnRow?.origin).toBe("spawn")
    const freeRow = await registry.get("free")
    expect(freeRow?.origin).toBeUndefined()
    expect(freeRow?.parentId).toBeUndefined()
    // Query filters: children of X / top-level-only listings.
    const children = await registry.list({ parentId: "parent-1" })
    expect(children.map((r) => r.sessionId).sort()).toEqual(["child-dag", "child-spawn"])
    const top = await registry.list({ excludeChildren: true })
    expect(top.map((r) => r.sessionId)).toContain("free")
    expect(top.map((r) => r.sessionId)).not.toContain("child-dag")
  })
})

describe("lifetime token usage", () => {
  it("folds Session.StepEnded usage into tokensUsed (input+output)", () => {
    const row = fold([
      created("s1", "/proj"),
      { aggregate: "session", aggregate_id: "s1", seq: 1, type: "Session.StepEnded", data: { sessionId: "s1", step: 1, finish: "tool", usage: { inputTokens: 100, outputTokens: 20 } } },
      { aggregate: "session", aggregate_id: "s1", seq: 2, type: "Session.StepEnded", data: { sessionId: "s1", step: 2, finish: "stop", usage: { inputTokens: 50, outputTokens: 30 } } },
    ])
    expect(row?.tokensUsed).toBe(200)
    // a usage-less log carries no field (absent = unknown, not 0-as-fake)
    const bare = fold([created("s2", "/proj")])
    expect(bare?.tokensUsed).toBeUndefined()
  })
})
