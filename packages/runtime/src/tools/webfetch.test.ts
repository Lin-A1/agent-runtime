import { describe, expect, it, afterEach } from "bun:test"
import { createWebFetchTool } from "./webfetch"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("web_fetch tool (wave 12)", () => {
  it("refuses http and private/loopback hosts before any network call", async () => {
    const tool = createWebFetchTool()
    let called = 0
    globalThis.fetch = (async () => {
      called += 1
      return new Response("x")
    }) as unknown as typeof fetch

    await expect(tool.execute({ url: "http://example.com" })).rejects.toThrow(/https/)
    await expect(tool.execute({ url: "https://localhost/x" })).rejects.toThrow(/private\/loopback/)
    await expect(tool.execute({ url: "https://127.0.0.1/x" })).rejects.toThrow(/private\/loopback/)
    await expect(tool.execute({ url: "https://192.168.1.1/x" })).rejects.toThrow(/private\/loopback/)
    await expect(tool.execute({})).rejects.toThrow(/url is required/)
    expect(called).toBe(0)
  })

  it("fetches, strips HTML to text, and reports truncation", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><head><style>body{color:red}</style></head><body><h1>Title</h1><script>evil()</script><p>Hello &amp; welcome</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch
    const tool = createWebFetchTool()
    const res = (await tool.execute({ url: "https://example.com/page" }, { caller: { kind: "user" } })) as { text: string; truncated: boolean; contentType: string }
    expect(res.contentType).toBe("text/html")
    expect(res.text).toContain("Title")
    expect(res.text).toContain("Hello & welcome")
    expect(res.text).not.toContain("evil()")
    expect(res.text).not.toContain("<h1>")
    expect(res.truncated).toBe(false)
  })

  it("surfaces non-2xx as a tool error", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch
    const tool = createWebFetchTool()
    await expect(tool.execute({ url: "https://example.com/missing" })).rejects.toThrow(/HTTP 404/)
  })
})
