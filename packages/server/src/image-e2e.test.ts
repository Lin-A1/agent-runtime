import { describe, expect, it } from "bun:test"
import { createServer, type ServerHandle } from "./server"
import type { AdapterConfig } from "@newhorse/llm"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * End-to-end image attachment simulation (user issue #14): a prompt WITH
 * images must lower into an actual image block on the OUTGOING provider
 * request — never dropped between the transport and the LLM call.
 */

const provider: AdapterConfig = { kind: "openai", baseUrl: "https://x", apiKey: "k" }

// 1x1 red PNG, raw base64 (valid, decodable, tiny).
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

describe("image attachments end-to-end (API simulation)", () => {
  it("a prompt with images lowers into a real image block on the provider request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nh-img-"))
    const captured: unknown[] = []
    let handle: ServerHandle | undefined
    try {
      const payload = [
        "data: " + JSON.stringify({ choices: [{ delta: { role: "assistant", content: "我看到图片了" }, finish_reason: "stop" }] }) + "\n\n",
        "data: [DONE]\n\n",
      ].join("")
      const captureFetch = async (_url: unknown, init?: { body?: string }): Promise<Response> => {
        // The adapter POSTs to the provider; capture the exact request body.
        if (init?.body) captured.push(JSON.parse(init.body))
        return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } })
      }
      handle = await createServer({ port: 0, sessionConfig: () => ({ provider, model: "m", dataDir: dir, fetch: captureFetch as never }) })
      const base = handle.baseUrl
      const { sessionId } = (await (await fetch(`${base}/v1/session`, { method: "POST", body: JSON.stringify({}) })).json()) as { sessionId: string }

      const prompt = await fetch(`${base}/v1/session/${sessionId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "看到图片了吗", images: [{ mime: "image/png", data: PNG_BASE64 }] }),
      })
      expect(prompt.status).toBe(200)
      await prompt.text() // drain the stream

      // The OUTGOING provider request must contain the image content block
      // (openai protocol lowers an image part to image_url with a data: URL).
      expect(captured.length).toBeGreaterThan(0)
      const body = captured[0] as { messages?: Array<{ role: string; content?: unknown }> }
      const serialized = JSON.stringify(body)
      expect(serialized).toContain("image_url")
      expect(serialized).toContain("data:image/png;base64,")
      expect(serialized).toContain(PNG_BASE64.slice(0, 40))

      // And the durable log records the attachment ref for the record.
      const events = (await (await fetch(`${base}/v1/session/${sessionId}/events`)).json()) as Array<{ type: string; data: Record<string, unknown> }>
      const admitted = events.find((e) => e.type === "Session.PromptAdmitted") as { data: { attachments?: unknown[]; images?: unknown[] } } | undefined
      const hasRefs = Boolean(admitted?.data.attachments?.length || admitted?.data.images?.length)
      expect(hasRefs).toBe(true)
    } finally {
      await handle?.stop()
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
