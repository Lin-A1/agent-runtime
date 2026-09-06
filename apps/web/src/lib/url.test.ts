import { describe, expect, it } from "bun:test"
import { safeExternalUrl } from "./url"

describe("safeExternalUrl", () => {
  it("allows absolute and relative http(s) URLs", () => {
    expect(safeExternalUrl("https://example.com/docs", "http://localhost")).toBe("https://example.com/docs")
    expect(safeExternalUrl("/docs", "http://localhost")).toBe("http://localhost/docs")
  })

  it("rejects executable and non-web protocols", () => {
    expect(safeExternalUrl("javascript:alert(1)", "http://localhost")).toBeNull()
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>", "http://localhost")).toBeNull()
    expect(safeExternalUrl("file:///etc/passwd", "http://localhost")).toBeNull()
  })
})
