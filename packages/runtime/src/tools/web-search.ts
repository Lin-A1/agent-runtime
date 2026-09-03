import type { Tool, ToolCtx } from "@newhorse/core"
import { fail } from "./common"
import { isRefusedHost, stripHtml } from "./webfetch"

/**
 * web_search: a self-hosted web search — no search-provider account, no API
 * key. It scrapes public HTML endpoints, CHINA-REACHABLE FIRST (DuckDuckGo is
 * unreachable from CN networks): cn.bing.com → Sogou → Baidu → DuckDuckGo
 * (html + lite) → www.bing.com. First non-empty result set wins. Read-only
 * (sideEffects: false) and gated by the host's `enableWeb` switch like
 * web_fetch, because it escapes the fs sandbox the same way.
 *
 * Guardrails mirror web_fetch: https-only, 10s per-attempt timeout (plus the
 * session's abort signal), 2 MiB download cap, private/loopback hosts refused
 * on every redirect hop (SSRF). Parsing is plain string ops / tiny regexes —
 * no DOM dependency. Sogou/Baidu wrap outbound URLs in redirect links; the
 * first maxResults are resolved to their real targets via manual-redirect
 * follows (same per-hop guard, capped and concurrent).
 */

const DOWNLOAD_CAP = 2_000_000
const TIMEOUT_MS = 10_000
const WRAPPER_RESOLVE_TIMEOUT_MS = 4_000
const MAX_RESULTS_DEFAULT = 5
const MAX_RESULTS_CAP = 10
/** A normal browser UA — the endpoints 403 an empty/agent UA. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

interface SearchResult {
  readonly title: string
  readonly url: string
  readonly snippet: string
}

type EngineName = "bing-cn" | "sogou" | "baidu" | "duckduckgo-html" | "duckduckgo-lite" | "bing"

interface Engine {
  readonly name: EngineName
  readonly url: (query: string) => string
  readonly parse: (html: string) => SearchResult[]
}

export function createWebSearchTool(): Tool {
  return {
    name: "web_search",
    sideEffects: false,
    description:
      "Search the public web without any API key (China-reachable first: cn.bing.com, Sogou, Baidu, then DuckDuckGo/Bing as fallbacks). Args: { query, maxResults? (1..10, default 5) }. Returns { results: [{ title, url, snippet }], engine }. Use it when you need fresh information beyond training data: current events, recent releases, documentation lookups, error messages. Results may be rate-limited by the backends; retry later or follow up with web_fetch on a result URL to read the page.",
    execute: async (input: unknown, ctx) => {
      const { query, maxResults } = (input ?? {}) as { query?: string; maxResults?: number }
      if (!query || !query.trim()) return fail("query is required")
      const limit = Math.max(1, Math.min(maxResults ?? MAX_RESULTS_DEFAULT, MAX_RESULTS_CAP))
      const errors: string[] = []
      let lastOkEngine: EngineName | undefined
      for (const engine of ENGINES) {
        let html: string
        try {
          html = await fetchText(engine.url(query), ctx)
        } catch (e) {
          errors.push(`${engine.name}: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        lastOkEngine = engine.name
        const results = dedupeByUrl(engine.parse(html))
        if (results.length === 0) continue
        const resolved = await resolveWrappers(results.slice(0, limit), ctx)
        return { results: resolved, engine: engine.name }
      }
      // Every backend errored — report the causes so the model can self-correct
      // (rate limit, network down, ...). Some backends answered but parsed empty:
      // an honest empty result set, not an error.
      if (!lastOkEngine) return fail(`all search backends failed: ${errors.join("; ")}`)
      return { results: [], engine: lastOkEngine }
    },
  }
}

const ENGINES: readonly Engine[] = [
  {
    name: "bing-cn",
    url: (q) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}`,
    parse: parseBing,
  },
  {
    name: "sogou",
    url: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`,
    parse: parseSogou,
  },
  {
    name: "baidu",
    url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
    parse: parseBaidu,
  },
  {
    name: "duckduckgo-html",
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDdgHtml,
  },
  {
    name: "duckduckgo-lite",
    url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    parse: parseDdgLite,
  },
  {
    name: "bing",
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    parse: parseBing,
  },
]

/** Redirect-hardened GET with per-hop validation (same shape as web_fetch):
 *  `redirect: "follow"` would let a 302 bounce the https/private-host guard. */
async function fetchText(url: string, ctx: ToolCtx | undefined): Promise<string> {
  let current = new URL(url)
  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== "https:") throw new Error("only https URLs are supported")
    if (isRefusedHost(current.hostname)) throw new Error("refused: private/loopback address")
    const signals: AbortSignal[] = [AbortSignal.timeout(TIMEOUT_MS)]
    if (ctx?.signal) signals.push(ctx.signal)
    const res = await fetch(current, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.8" },
      redirect: "manual",
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location")
      if (!loc) throw new Error(`HTTP ${res.status} without a location header`)
      current = new URL(loc, current)
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${current.host}`)
    if (!res.body) return ""
    return readBodyCapped(res)
  }
  throw new Error("too many redirects")
}

/** Incremental download cap: content-length is advisory — a chunked hostile
 *  server must not stream unbounded bytes into memory. */
async function readBodyCapped(res: Response): Promise<string> {
  const reader = res.body!.getReader()
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
  return raw
}

/** DDG html endpoint: results are `<a class="result__a">` titles paired in
 *  document order with `<a class="result__snippet">` snippets. */
function parseDdgHtml(html: string): SearchResult[] {
  const anchors = [...html.matchAll(/<a\b[^>]*\bclass\s*=\s*"[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
  const snippets = [...html.matchAll(/<a\b[^>]*\bclass\s*=\s*"[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
  return anchors.flatMap((a, i) => {
    const href = extractAttr(a[0], "href")
    if (!href) return []
    return [{ title: stripHtml(a[1] ?? ""), url: resolveResultUrl(href), snippet: stripHtml(snippets[i]?.[1] ?? "") }]
  })
}

/** DDG lite endpoint: a plain table — `<a class='result-link'>` titles (single
 *  or double quotes) paired with `<td class='result-snippet'>` rows. */
function parseDdgLite(html: string): SearchResult[] {
  const anchors = [...html.matchAll(/<a\b[^>]*\bclass\s*=\s*["'][^"']*\bresult-link\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
  const snippets = [...html.matchAll(/<td\b[^>]*\bclass\s*=\s*["'][^"']*\bresult-snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)]
  return anchors.flatMap((a, i) => {
    const href = extractAttr(a[0], "href")
    if (!href) return []
    return [{ title: stripHtml(a[1] ?? ""), url: resolveResultUrl(href), snippet: stripHtml(snippets[i]?.[1] ?? "") }]
  })
}

/** Bing public results: `<li class="b_algo"><h2><a href=...>` per result, with
 *  the first `<p>` in the block as the snippet. Same structure on cn.bing.com
 *  and www.bing.com. */
function parseBing(html: string): SearchResult[] {
  const blocks = html.split(/<li\s+class="b_algo"[^>]*>/i).slice(1)
  return blocks.flatMap((block) => {
    const m = block.match(/<h2[^>]*>\s*<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!m) return []
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    return [{ title: stripHtml(m[2] ?? ""), url: m[1] ?? "", snippet: stripHtml(p?.[1] ?? "") }]
  })
}

/** Sogou results: `<div class="vrwrap">` blocks with `<h3 class="vr-title"><a>`
 *  titles and `fz-mid space-txt` snippet divs. Outbound links are `/link?url=`
 *  wrappers (relative — absolutized for the resolver). */
function parseSogou(html: string): SearchResult[] {
  const blocks = html.split(/<div\s+class="vrwrap"[^>]*>/i).slice(1)
  return blocks.flatMap((block) => {
    const m = block.match(/<h3[^>]*\bclass\s*=\s*"[^"]*\bvr-title\b[^"]*"[^>]*>[\s\S]*?<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!m) return []
    const href = m[1]!.replace(/&amp;/gi, "&")
    const url = href.startsWith("/") ? `https://www.sogou.com${href}` : href
    const p = block.match(/<div[^>]*\bclass\s*=\s*"[^"]*\bspace-txt\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    return [{ title: stripHtml(m[2] ?? ""), url, snippet: stripHtml(p?.[1] ?? "") }]
  })
}

/** Baidu results: `<h3 class="t..."><a href="baidu.com/link?url=...">` titles;
 *  snippets in a `c-abstract` div. Anti-bot answer ("百度安全验证") parses
 *  empty and falls through to the next backend. */
function parseBaidu(html: string): SearchResult[] {
  if (html.includes("百度安全验证")) return []
  const blocks = html.split(/<h3[^>]*\bclass\s*=\s*"[^"]*\bt\b[^"]*"[^>]*>/i).slice(1)
  return blocks.flatMap((block) => {
    const m = block.match(/^\s*<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!m) return []
    const p = block.match(/<div[^>]*\bclass\s*=\s*"[^"]*\bc-abstract\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    return [{ title: stripHtml(m[2] ?? ""), url: m[1] ?? "", snippet: stripHtml(p?.[1] ?? "") }]
  })
}

/** Sogou/Baidu wrap outbound URLs in redirect links. Resolve the first N
 *  results to their real targets via manual-redirect follows (same per-hop
 *  https/public-host guard, 4s each, concurrent); a failed resolve keeps the
 *  wrapper URL (it is still clickable). Non-wrapper URLs pass through. */
async function resolveWrappers(results: SearchResult[], ctx: ToolCtx | undefined): Promise<SearchResult[]> {
  const isWrapper = (u: string): boolean => /(sogou\.com|baidu\.com)\/link\?/i.test(u)
  return Promise.all(
    results.map(async (r) => {
      if (!isWrapper(r.url)) return r
      try {
        const real = await followRedirect(r.url, ctx)
        return { ...r, url: real }
      } catch {
        return r
      }
    }),
  )
}

/** One manual redirect chain, ending at the final absolute URL. */
async function followRedirect(url: string, ctx: ToolCtx | undefined): Promise<string> {
  let current = new URL(url)
  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") throw new Error("bad scheme")
    if (isRefusedHost(current.hostname)) throw new Error("refused: private/loopback address")
    const signals: AbortSignal[] = [AbortSignal.timeout(WRAPPER_RESOLVE_TIMEOUT_MS)]
    if (ctx?.signal) signals.push(ctx.signal)
    const res = await fetch(current, {
      headers: { "user-agent": USER_AGENT },
      redirect: "manual",
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    })
    await res.body?.cancel()
    if (![301, 302, 303, 307, 308].includes(res.status)) return current.toString()
    const loc = res.headers.get("location")
    if (!loc) return current.toString()
    current = new URL(loc, current)
  }
  return current.toString()
}

/** Extract an attribute from a single tag; handles single- and double-quoted
 *  values (DDG lite mixes both). */
function extractAttr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))
  return m?.[1] ?? m?.[2]
}

/** DDG wraps outbound links as `//duckduckgo.com/l/?uddg=<urlencoded>` —
 *  decode `uddg` to reach the real target. Plain hrefs pass through. */
function resolveResultUrl(href: string): string {
  const decoded = href.replace(/&amp;/gi, "&")
  const abs = decoded.startsWith("//") ? `https:${decoded}` : decoded
  const uddg = abs.match(/[?&]uddg=([^&]*)/i)
  if (!uddg) return abs
  try {
    return decodeURIComponent(uddg[1]!)
  } catch {
    return abs
  }
}

/** Keep absolute http(s) result URLs only (drops `javascript:`/relative junk),
 *  dedupe by url, and drop entries with no title. */
function dedupeByUrl(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results.filter((r) => {
    if (!r.title || !/^https?:\/\//i.test(r.url) || seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}
