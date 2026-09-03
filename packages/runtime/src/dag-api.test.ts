import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MemoryEventStore, type DAGSpec } from "@newhorse/core"
import type { AdapterConfig, Fetcher } from "@newhorse/llm"
import { createDagRunner, type DagRunner, type DagStatus } from "./dag-api"

const provider: AdapterConfig = { kind: "openai", baseUrl: "https://x", apiKey: "k" }

/** Mock OpenAI-compatible fetch: one text delta then stop (the node succeeds). */
const okFetch: Fetcher = async () =>
  new Response(
    [
      "data: " + JSON.stringify({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }) + "\n\n",
      "data: [DONE]\n\n",
    ].join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  )

/** Mock fetch that hangs until the request's abort signal fires — a node that
 *  stays `running` until the graph is aborted. */
const hangingFetch: Fetcher = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const err = new Error("aborted") as Error & { name: string }
      err.name = "AbortError"
      reject(err)
    })
  })

const chain: DAGSpec = {
  nodes: {
    A: { id: "A", agent: { name: "a", model: "m" }, input: "root" },
    B: { id: "B", agent: { name: "b", model: "m" }, input: "next", dependsOn: ["A"] },
  },
}

async function makeRunner(fetch: Fetcher): Promise<{ runner: DagRunner; cleanup: () => Promise<void> }> {
  const dataDir = await mkdtemp(join(tmpdir(), "newhorse-dag-api-"))
  const runner = createDagRunner({
    dataDir,
    events: new MemoryEventStore(),
    getProvider: () => provider,
    getDefaultModel: () => "m",
    getWorkspace: () => dataDir,
    fetch,
  })
  return { runner, cleanup: () => rm(dataDir, { recursive: true, force: true }) }
}

async function waitFor(pred: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await pred()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error("waitFor timed out")
}

async function untilDone(runner: DagRunner, dagId: string): Promise<DagStatus> {
  let st: DagStatus | undefined
  await waitFor(async () => {
    st = await runner.status(dagId)
    return st?.done === true
  })
  return st!
}

describe("dag api runner", () => {
  it("status exposes the declared dependsOn edges per node", async () => {
    const { runner, cleanup } = await makeRunner(okFetch)
    try {
      const { dagId } = await runner.run(chain)
      const st = await untilDone(runner, dagId)
      expect(st.nodes.find((n) => n.node === "A")?.dependsOn).toBeUndefined()
      expect(st.nodes.find((n) => n.node === "B")?.dependsOn).toEqual(["A"])
    } finally {
      await cleanup()
    }
  })

  it("abort on an unknown dag id throws", async () => {
    const { runner, cleanup } = await makeRunner(okFetch)
    try {
      await expect(runner.abort("nope")).rejects.toThrow("unknown dag id")
    } finally {
      await cleanup()
    }
  })

  it("abort on an already-done graph reports not aborted", async () => {
    const { runner, cleanup } = await makeRunner(okFetch)
    try {
      const { dagId } = await runner.run(chain)
      await untilDone(runner, dagId)
      const res = await runner.abort(dagId)
      expect(res.aborted).toBe(false)
      expect(res.note).toBe("already done")
    } finally {
      await cleanup()
    }
  })

  it("abort a running graph flips running→aborted and pending→skipped", async () => {
    const { runner, cleanup } = await makeRunner(hangingFetch)
    try {
      const { dagId } = await runner.run(chain)
      // Wait until A is durably claimed so the abort lands on a RUNNING graph
      // (not on a not-yet-started one, which would only exercise the pre-flight
      // signal check).
      await waitFor(async () => (await runner.status(dagId))?.nodes.some((n) => n.node === "A" && n.state === "running") === true)
      const res = await runner.abort(dagId)
      expect(res.aborted).toBe(true)
      const st = await untilDone(runner, dagId)
      expect(st.nodes.find((n) => n.node === "A")?.state).toBe("aborted")
      expect(st.nodes.find((n) => n.node === "B")?.state).toBe("skipped")
    } finally {
      await cleanup()
    }
  }, 15_000)
})
