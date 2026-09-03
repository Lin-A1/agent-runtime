import type { Tool } from "@newhorse/core"

/**
 * web_fetch (wave 12, docs/runtime-comparison.md §6.5 #25): the model could
 * read the workspace but not the web — every peer harness ships a fetch tool.
 * Read-only semantics (sideEffects: false, so plan mode keeps it), gated by
 * the host's `enableWeb` switch because it escapes the fs sandbox like bash.
 *
 * Guardrails: https-only, 10s timeout (plus the session's abort signal),
 * 2 MiB download cap, private/loopback hosts refused (SSRF), HTML stripped to
 * text, output capped to the caller's slice — the loop's per-result truncation
 * applies on top of whatever this returns.
 */

const DOWNLOAD_CAP = 2_000_000
const MAX_CHARS_DEFAULT = 20_000

/** Exported so web_search strips titles/snippets with the exact same entity
 *  and tag handling as fetched pages — one canonical HTML→text path. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
}

export function createWebFetchTool(): Tool {
  return {
    name: "web_fetch",
    sideEffects: false,
    description:
      "Fetch a public https URL and return its text content (HTML stripped to text; JSON/plain pass through). Args: { url, maxChars? }. Limits: 10s timeout, 2MiB download, private/loopback hosts refused. Use it to read documentation, APIs, or any page the task needs.",
    execute: async (input: unknown, ctx) => {
      const { url, maxChars } = (input ?? {}) as { url?: string; maxChars?: number }
      if (!url) throw new Error("url is required")
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error(`invalid url: ${url}`)
      }
      if (parsed.protocol !== "https:") throw new Error("only https URLs are supported")
      // Redirect loop with per-hop validation: `redirect: "follow"` would let
      // a 302 bounce the guard (public URL → private/loopback target). DNS
      // rebinding remains a documented residual risk (a full fix needs
      // resolve-and-pin; enableWeb is opt-in and bash is strictly stronger).
      let res: Response | undefined
      let current = parsed
      for (let hop = 0; hop < 5; hop++) {
        if (isRefusedHost(current.hostname)) throw new Error("refused: private/loopback address")
        const signals: AbortSignal[] = [AbortSignal.timeout(10_000)]
        if (ctx?.signal) signals.push(ctx.signal)
        res = await fetch(current, {
          headers: { "user-agent": "newhorse-agent/0.1 (web_fetch)", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
          redirect: "manual",
          signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
        })
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get("location")
          if (!loc) break
          current = new URL(loc, current)
          if (current.protocol !== "https:") throw new Error("refused: redirect to a non-https target")
          continue
        }
        break
      }
      if (!res!.ok) throw new Error(`HTTP ${res!.status} for ${parsed.host}`)
      // 204/headless responses carry no body — return an empty-page result
      // instead of crashing on res.body.getReader().
      if (!res!.body) {
        return { url: current.toString(), contentType: "", totalChars: 0, truncated: false, text: "" }
      }
      // Incremental download cap: content-length is advisory — a chunked
      // hostile server must not stream unbounded bytes into memory before
      // the slice.
      const reader = res!.body.getReader()
      const decoder = new TextDecoder()
      let raw = ""
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > DOWNLOAD_CAP) {
          await reader.cancel()
          throw new Error(`download too large: >${DOWNLOAD_CAP} bytes (cap exceeded mid-stream)`)
        }
        raw += decoder.decode(value, { stream: true })
      }
      const ct = res!.headers.get("content-type") ?? ""
      const body = raw.length > DOWNLOAD_CAP ? raw.slice(0, DOWNLOAD_CAP) : raw
      const text = ct.includes("html") ? stripHtml(body) : body
      const cap = Math.max(200, Math.min(maxChars ?? MAX_CHARS_DEFAULT, MAX_CHARS_DEFAULT))
      return {
        url: current.toString(),
        contentType: ct.split(";")[0] ?? "",
        totalChars: text.length,
        truncated: text.length > cap,
        text: text.slice(0, cap),
      }
    },
  }
}

/** Literal-form private/loopback refusals. Residual risk (documented): a DNS
 *  name resolving to a private IP, and non-literal IP encodings beyond the
 *  decimal/ hex forms below — a full fix needs resolve-and-pin. Exported so
 *  web_search applies the identical refusal to its own redirect hops. */
export function isRefusedHost(hostname: string): boolean {
  // Private/loopback/link-local: v4 classes incl. 172.16.0.0/12; v6 loopback,
  // unspecified, ULA (fc00::/7 → fc/fd), link-local (fe80::/10).
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|\[::\]|\[(fd|fc|fe80)[0-9a-f:]*\])/i.test(hostname)) return true
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) return true
  return false
}
