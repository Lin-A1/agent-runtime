import { describe, expect, test } from "bun:test"
import type { Fetcher } from "./route"
import { AdapterUnavailableError, BUILTIN_PROVIDERS, createAdapterRegistry } from "./registry"
import type { LLMRequest } from "@newhorse/schema"

function request(): LLMRequest {
  return { model: "test-model", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }
}

describe("adapter registry", () => {
  test("builtins create executable clients with injected fetch", async () => {
    const calls: string[] = []
    const fakeFetch: Fetcher = async (url, init) => {
      calls.push(`${String(url)} ${String((init?.headers as Record<string, string>)?.Authorization)}`)
      return new Response("data: [DONE]\\n\\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    const registry = createAdapterRegistry()
    const client = registry.createClient({ providerId: "openai", kind: "anthropic", baseUrl: "https://example.test", apiKey: "secret" }, fakeFetch)
    for await (const _event of await client.stream(request())) void _event
    expect(calls).toEqual(["https://example.test/v1/chat/completions Bearer secret"])
    expect(registry.resolveClient("openai").id).toBe("openai")
  })

  test("unknown and metadata-only providers fail explicitly", () => {
    const metadataProvider = { id: "metadata", name: "Metadata", kind: "openai" as const, defaultBaseUrl: "https://example.test" }
    const registry = createAdapterRegistry([metadataProvider])
    expect(() => registry.resolveClient("missing")).toThrow(AdapterUnavailableError)
    expect(() => registry.createClient({ providerId: "metadata", kind: "openai", baseUrl: metadataProvider.defaultBaseUrl })).toThrow("metadata")
  })

  test("rejects invalid and duplicate ids", () => {
    expect(() => createAdapterRegistry([{ id: "", name: "x", kind: "openai", defaultBaseUrl: "x" }])).toThrow()
    expect(() => createAdapterRegistry([{ id: "x", name: "x", kind: "openai", defaultBaseUrl: "x" }, { id: "x", name: "y", kind: "openai", defaultBaseUrl: "y" }])).toThrow()
  })

  test("rejects duplicate registration", () => {
    const registry = createAdapterRegistry([])
    const provider = { id: "x", name: "x", kind: "openai" as const, defaultBaseUrl: "a" }
    registry.register(provider)
    expect(() => registry.register(provider)).toThrow()
  })

  test("out-of-order disposal never resurrects a replaced provider", () => {
    const registry = createAdapterRegistry([])
    const first = { id: "x", name: "first", kind: "openai" as const, defaultBaseUrl: "a" }
    const second = { ...first, name: "second", defaultBaseUrl: "b" }
    const dispose = registry.register(first)
    expect(() => registry.register(second)).toThrow()
    dispose()
    expect(registry.get("x")).toBeUndefined()
  })
})
