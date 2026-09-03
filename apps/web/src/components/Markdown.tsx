import React, { useEffect, useState } from "react"

/**
 * Minimal markdown renderer for assistant turns — headings, fenced code
 * (header + copy + line numbers + diff tint), mermaid diagrams, blockquotes,
 * lists, bold, inline code, links. React-element output (no HTML injection)
 * except the mermaid SVG, which comes from mermaid's own strict-sanitized
 * renderer.
 */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }): React.ReactElement {
  const blocks: React.ReactElement[] = []
  const lines = text.split("\n")
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buf.push(lines[i]!)
        i++
      }
      i++ // closing fence
      blocks.push(lang === "mermaid" ? <MermaidBlock key={key++} code={buf.join("\n")} /> : <CodeBlock key={key++} lang={lang} code={buf.join("\n")} />)
      continue
    }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length
      const content = inline(line.replace(/^#+\s*/, ""))
      blocks.push(level === 1 ? <h1 key={key++}>{content}</h1> : level === 2 ? <h2 key={key++}>{content}</h2> : <h3 key={key++}>{content}</h3>)
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^>\s?/, ""))
        i++
      }
      blocks.push(<blockquote key={key++}>{inline(buf.join(" "))}</blockquote>)
      continue
    }
    // pipe table (wave 8 detail): header row + separator row → <table>
    if (/^\|.*\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+$/.test(lines[i + 1]!)) {
      const cells = (row: string): string[] =>
        row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
      const header = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\|.*\|/.test(lines[i]!)) {
        rows.push(cells(lines[i]!))
        i++
      }
      blocks.push(
        <div key={key++} className="tablewrap">
          <table>
            <thead>
              <tr>{header.map((h, ci) => (<th key={ci}>{inline(h)}</th>))}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => (<td key={ci}>{inline(c)}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line)
      const items: React.ReactElement[] = []
      while (i < lines.length && (/^[-*]\s/.test(lines[i]!) || /^\d+\.\s/.test(lines[i]!))) {
        items.push(<li key={items.length}>{inline(lines[i]!.replace(/^([-*]|\d+\.)\s*/, ""))}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>)
      continue
    }
    if (line.trim() === "") {
      i++
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i]!.trim() !== "" && !lines[i]!.startsWith("```") && !/^#{1,3}\s/.test(lines[i]!) && !/^[-*]\s/.test(lines[i]!) && !/^\d+\.\s/.test(lines[i]!) && !/^>\s?/.test(lines[i]!)) {
      buf.push(lines[i]!)
      i++
    }
    blocks.push(<p key={key++}>{inline(buf.join("\n"))}</p>)
  }
  if (streaming) blocks.push(<span key="caret" className="stream-caret" />)
  return <div className="md">{blocks}</div>
}

/** Mermaid fenced block → diagram. The mermaid bundle is heavy, so it is
 *  dynamically imported only when a diagram actually appears (streaming shows
 *  the raw code until the block parses). Theme follows data-theme; a parse
 *  failure falls back to the plain code display with a hint. */
/** Models often write `flowchart LR A --> B` with statements sharing the
 *  declaration line; mermaid's grammar wants them on their own lines. Split
 *  the header from whatever follows (direction token first, if present). */
function normalizeMermaid(src: string): string {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/^([ \t]*(?:flowchart|graph)[ \t]+(?:TB|TD|BT|RL|LR|td|tb|bt|rl|lr)?)[ \t]+(?=\S)/m, "$1\n")
}

function MermaidBlock({ code }: { code: string }): React.ReactElement {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setSvg(null)
    setError(null)
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid")
        const dark = document.documentElement.dataset.theme === "dark"
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" })
        const id = `mmd-${Math.random().toString(36).slice(2)}`
        const rendered = await mermaid.render(id, normalizeMermaid(code))
        if (alive) setSvg(rendered.svg)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [code])
  if (error) return <CodeBlock lang={`mermaid（渲染失败: ${error}）`} code={code} />
  if (!svg) return <CodeBlock lang="mermaid" code={code} />
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>mermaid</span>
      </div>
      <div className="codeblock-body mermaid-host" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

function CodeBlock({ lang, code }: { lang: string; code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const done = (): void => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(code).then(done).catch(() => fallback())
    else fallback()
    function fallback(): void {
      // plain-HTTP LAN access has no clipboard API — use a hidden textarea
      const ta = document.createElement("textarea")
      ta.value = code
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand("copy")
        done()
      } catch {
        /* clipboard unavailable */
      }
      ta.remove()
    }
  }
  // treat as diff only when the language says so or hunk markers are present
  const diffish = lang === "diff" || /^@@/m.test(code) || /^diff --git/m.test(code)
  const bodyLines = code.replace(/\n$/, "").split("\n")
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{lang || "code"}</span>
        <button className="codeblock-copy" onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div className="codeblock-body">
        {bodyLines.map((l, n) => {
          const cls = diffish ? (l.startsWith("+") ? "cline add" : l.startsWith("-") ? "cline del" : "cline") : "cline"
          return (
            <div key={n} className={cls}>
              <span className="ln">{n + 1}</span>
              <span>{l || " "}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Inline: **bold**, `code`, [text](url) */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith("**")) out.push(<strong key={k++}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith("`")) out.push(<code key={k++} className="inline">{token.slice(1, -1)}</code>)
    else {
      const mm = token.match(/\[([^\]]+)\]\(([^)]+)\)/)!
      out.push(
        <a key={k++} href={mm[2]} target="_blank" rel="noreferrer">
          {mm[1]}
        </a>,
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
