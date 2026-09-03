import React, { useEffect, useState } from "react"
import { Check, Copy, Download, Image as ImageIcon } from "lucide-react"

/**
 * Markdown renderer for assistant turns:
 * - Clean typography ladder (inter/system)
 * - Pro codeblocks with language tag, line numbers, and live copy
 * - Mermaid diagrams with dynamic code-splitting, zero global error leaks,
 *   source copy, image-to-clipboard copy, and SVG download.
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
      const isClosed = i < lines.length && lines[i]!.startsWith("```")
      if (isClosed) i++ // closing fence
      const code = buf.join("\n")

      if (lang === "mermaid") {
        blocks.push(<MermaidBlock key={key++} code={code} isClosed={isClosed} />)
      } else {
        blocks.push(<CodeBlock key={key++} lang={lang} code={code} />)
      }
      continue
    }

    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length
      const content = inline(line.replace(/^#+\s*/, ""))
      blocks.push(
        level === 1 ? (
          <h1 key={key++} className="mt-4 mb-2 text-lg font-bold tracking-tight text-fg">
            {content}
          </h1>
        ) : level === 2 ? (
          <h2 key={key++} className="mt-3.5 mb-1.5 text-base font-semibold tracking-tight text-fg">
            {content}
          </h2>
        ) : (
          <h3 key={key++} className="mt-2.5 mb-1 text-sm font-semibold text-fg">
            {content}
          </h3>
        ),
      )
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^>\s?/, ""))
        i++
      }
      blocks.push(
        <blockquote key={key++} className="my-2.5 border-l-2 border-accent/60 pl-3.5 text-xs leading-relaxed text-dim italic">
          {inline(buf.join(" "))}
        </blockquote>,
      )
      continue
    }

    // pipe table: header row + separator row -> <table>
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
        <div key={key++} className="my-3 overflow-x-auto rounded-xl border border-line bg-card shadow-sm">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line bg-hover/40 text-2xs font-semibold uppercase text-faint">
                {header.map((h, ci) => (
                  <th key={ci} className="px-3.5 py-2">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-dim">
              {rows.map((r, ri) => (
                <tr key={ri} className="hover:bg-hover/30 transition-colors">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3.5 py-2 leading-relaxed">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line)
      const items: React.ReactElement[] = []
      while (i < lines.length && (/^[-*]\s/.test(lines[i]!) || /^\d+\.\s/.test(lines[i]!))) {
        items.push(<li key={items.length} className="my-0.5">{inline(lines[i]!.replace(/^([-*]|\d+\.)\s*/, ""))}</li>)
        i++
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className="my-2 ml-5 list-decimal text-sm leading-relaxed text-dim space-y-0.5">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="my-2 ml-5 list-disc text-sm leading-relaxed text-dim space-y-0.5">
            {items}
          </ul>
        ),
      )
      continue
    }

    if (line.trim() === "") {
      i++
      continue
    }

    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.startsWith("```") &&
      !/^#{1,3}\s/.test(lines[i]!) &&
      !/^[-*]\s/.test(lines[i]!) &&
      !/^\d+\.\s/.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!)
    ) {
      buf.push(lines[i]!)
      i++
    }
    blocks.push(
      <p key={key++} className="my-2 text-sm leading-relaxed text-fg">
        {inline(buf.join("\n"))}
      </p>,
    )
  }

  if (streaming) blocks.push(<span key="caret" className="stream-caret" />)
  return <div className="md text-fg">{blocks}</div>
}

/** Normalize messy model outputs (e.g. statement placed on flowchart declaration line) */
function normalizeMermaid(src: string): string {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/^([ \t]*(?:flowchart|graph)[ \t]+(?:TB|TD|BT|RL|LR|td|tb|bt|rl|lr)?)[ \t]+(?=\S)/m, "$1\n")
}

/** Clean up any rogue error elements appended to document.body by mermaid */
function purgeMermaidBodyErrors(): void {
  try {
    document.querySelectorAll("[id^='dmermaid'], [id^='mermaid-']").forEach((el) => {
      if (el.parentNode && el.tagName.toLowerCase() !== "svg" && !el.closest(".mermaid-host")) {
        el.remove()
      }
    })
  } catch {}
}

/** Mermaid diagram block with rich toolbar (copy text, copy image, download svg) */
function MermaidBlock({ code, isClosed = true }: { code: string; isClosed?: boolean }): React.ReactElement {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedImg, setCopiedImg] = useState(false)

  useEffect(() => {
    // If block is unclosed during streaming, wait until closed before rendering diagram
    if (!isClosed) return

    let alive = true
    setSvg(null)
    setError(null)

    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid")
        const dark = document.documentElement.dataset.theme === "dark"
        // CRITICAL: suppressErrorRendering prevents mermaid from appending ugly bomb error divs to document.body
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: dark ? "dark" : "default",
        })
        const id = `mmd-${Math.random().toString(36).slice(2, 10)}`
        const rendered = await mermaid.render(id, normalizeMermaid(code))
        if (alive) {
          setSvg(rendered.svg)
          purgeMermaidBodyErrors()
        }
      } catch (err) {
        purgeMermaidBodyErrors()
        if (alive) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()

    return () => {
      alive = false
      purgeMermaidBodyErrors()
    }
  }, [code, isClosed])

  const copyCode = (): void => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 1500)
    })
  }

  const copyImage = (): void => {
    if (!svg) return
    try {
      const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
      const url = URL.createObjectURL(svgBlob)
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const scale = 2
        const naturalW = img.naturalWidth || 600
        const naturalH = img.naturalHeight || 400
        canvas.width = Math.round(naturalW * scale)
        canvas.height = Math.round(naturalH * scale)
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.fillStyle = document.documentElement.dataset.theme === "dark" ? "#111214" : "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        canvas.toBlob((blob) => {
          if (!blob) return
          if (navigator.clipboard?.write) {
            void navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(() => {
              setCopiedImg(true)
              setTimeout(() => setCopiedImg(false), 1500)
            })
          }
        }, "image/png")
      }
      img.src = url
    } catch {
      copyCode()
    }
  }

  const downloadSvg = (): void => {
    if (!svg) return
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `diagram-${Date.now()}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error || !isClosed || !svg) {
    return (
      <div className="codeblock my-3">
        <div className="codeblock-bar flex items-center justify-between">
          <span className="text-2xs font-mono text-faint">mermaid {!isClosed ? "(生成中…)" : error ? "(解析未完成，显示源码)" : ""}</span>
          <button className="codeblock-copy flex items-center gap-1" onClick={copyCode}>
            {copiedCode ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
            <span>{copiedCode ? "已复制" : "复制"}</span>
          </button>
        </div>
        <div className="codeblock-body">
          <pre className="whitespace-pre-wrap font-mono text-2xs leading-relaxed text-dim p-3">{code}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="codeblock my-3 overflow-hidden rounded-xl border border-line bg-card shadow-sm">
      <div className="codeblock-bar flex items-center justify-between border-b border-line bg-hover/30 px-3 py-1.5 text-2xs text-faint">
        <span className="font-mono font-medium text-dim">mermaid 拓扑图</span>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-faint hover:text-fg hover:bg-hover transition-colors"
            title="复制 PNG 图片到剪贴板"
            onClick={copyImage}
          >
            {copiedImg ? <Check size={11} className="text-ok" /> : <ImageIcon size={11} />}
            <span>{copiedImg ? "图片已复制" : "复制图片"}</span>
          </button>
          <button
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-faint hover:text-fg hover:bg-hover transition-colors"
            title="复制 Mermaid 原始代码"
            onClick={copyCode}
          >
            {copiedCode ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
            <span>{copiedCode ? "代码已复制" : "复制代码"}</span>
          </button>
          <button
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-faint hover:text-fg hover:bg-hover transition-colors"
            title="下载 SVG 矢量图"
            onClick={downloadSvg}
          >
            <Download size={11} />
            <span>下载 SVG</span>
          </button>
        </div>
      </div>
      <div className="codeblock-body mermaid-host p-4 flex justify-center bg-surface/50" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

/** Standard Code block with clean toolbar & syntax copy */
function CodeBlock({ lang, code }: { lang: string; code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    }
  }

  const diffish = lang === "diff" || /^@@/m.test(code) || /^diff --git/m.test(code)
  const bodyLines = code.replace(/\n$/, "").split("\n")

  return (
    <div className="codeblock my-3 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="codeblock-bar flex items-center justify-between border-b border-line bg-hover/30 px-3 py-1.5 text-2xs text-faint">
        <span className="font-mono text-dim">{lang || "code"}</span>
        <button
          className="codeblock-copy flex items-center gap-1 rounded-md px-2 py-0.5 text-faint hover:text-fg hover:bg-hover transition-colors"
          onClick={copy}
        >
          {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <div className="codeblock-body overflow-x-auto py-2 text-2xs font-mono leading-relaxed">
        {bodyLines.map((l, n) => {
          const cls = diffish ? (l.startsWith("+") ? "cline add" : l.startsWith("-") ? "cline del" : "cline") : "cline"
          return (
            <div key={n} className={cls}>
              <span className="ln select-none font-mono text-txt-ghost">{n + 1}</span>
              <span>{l || " "}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Inline elements: **bold**, `code`, [text](url) */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-fg">{token.slice(2, -2)}</strong>)
    else if (token.startsWith("`"))
      out.push(
        <code key={k++} className="inline rounded bg-hover px-1.5 py-0.5 font-mono text-2xs text-accent">
          {token.slice(1, -1)}
        </code>,
      )
    else {
      const mm = token.match(/\[([^\]]+)\]\(([^)]+)\)/)!
      out.push(
        <a key={k++} href={mm[2]} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-strong">
          {mm[1]}
        </a>,
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
