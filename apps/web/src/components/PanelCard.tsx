/**
 * Panel card renderer — one card per Session.PanelPosted / `panel` frame.
 * Kind set: diff / image / table / url / markdown / form + JSON fallback.
 * Payload shapes follow the engine's `Tool.presents.toPanel` derivations
 * (packages/runtime/src/tools): diff = {path, diff:"- /+ lines"}, image =
 * {mime, data(base64), path}, table = {engine?, rows:[{title,url,snippet}]},
 * url = {url, contentType?, preview?}.
 */
import { ArrowUpRight, Braces, FileDiff, ImageIcon, Table2 } from "lucide-react"
import { Markdown } from "./Markdown"
import type { PanelInfo } from "../api/types"
import { safeExternalUrl } from "../lib/url"

const KIND_ICON: Record<string, React.ReactElement> = {
  diff: <FileDiff size={13} />,
  image: <ImageIcon size={13} />,
  table: <Table2 size={13} />,
  url: <ArrowUpRight size={13} />,
  markdown: <Braces size={13} />,
}

function DiffBody({ payload }: { payload: Record<string, unknown> }): React.ReactElement {
  const text = String(payload.diff ?? "")
  const lines = text.split("\n")
  return (
    <div className="codeblock-body overflow-x-auto py-1 text-2xs leading-relaxed">
      {lines.map((line, i) => {
        const cls = line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "del" : "same"
        return (
          <div key={i} className={`cline ${cls}`}>
            <span className="whitespace-pre-wrap break-all">{cls === "same" ? line : line.slice(2)}</span>
          </div>
        )
      })}
      {payload.replaced !== undefined && <div className="px-3 pt-1 text-2xs text-faint">替换 {String(payload.replaced)} 处</div>}
    </div>
  )
}

function ImageBody({ payload }: { payload: Record<string, unknown> }): React.ReactElement | null {
  const mime = String(payload.mime ?? "image/png")
  const data = String(payload.data ?? "")
  if (!data) return null
  return (
    <div className="p-2">
      <img src={`data:${mime};base64,${data}`} alt={String(payload.path ?? "image")} className="max-h-80 rounded-lg border border-line object-contain" />
      {payload.path ? <div className="mt-1 text-2xs text-faint">{String(payload.path)}</div> : null}
    </div>
  )
}

function TableBody({ payload }: { payload: Record<string, unknown> }): React.ReactElement {
  const rows = Array.isArray(payload.rows) ? (payload.rows as Array<Record<string, unknown>>) : []
  // web_search shape: title/url/snippet result cards
  if (rows.length > 0 && rows.every((r) => typeof r.title === "string" || typeof r.url === "string")) {
    return (
      <div className="flex flex-col gap-2 p-2.5">
        {rows.map((r, i) => (
          <div key={i} className="min-w-0">
            {typeof r.url === "string" && r.url ? (() => {
              const href = safeExternalUrl(r.url)
              return href ? (
                <a href={href} target="_blank" rel="noreferrer" className="block truncate text-xs font-medium text-accent hover:underline">
                  {String(r.title ?? r.url)}
                </a>
              ) : <span className="block truncate text-xs font-medium text-dim" title="链接协议不受支持">{String(r.title ?? r.url)}</span>
            })() : (
              <span className="truncate text-xs font-medium text-fg">{String(r.title ?? "")}</span>
            )}
            {typeof r.snippet === "string" && r.snippet ? <div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-dim">{r.snippet}</div> : null}
            {typeof r.url === "string" && r.url ? <div className="mt-0.5 truncate text-2xs text-ghost">{r.url}</div> : null}
          </div>
        ))}
      </div>
    )
  }
  return <JsonBody payload={payload} />
}

function UrlBody({ payload }: { payload: Record<string, unknown> }): React.ReactElement {
  const url = String(payload.url ?? "")
  const preview = typeof payload.preview === "string" ? payload.preview : ""
  return (
    <div className="p-2.5">
      {url ? (() => {
        const href = safeExternalUrl(url)
        return href ? (
          <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-1 break-all text-xs font-medium text-accent hover:underline">
            {url} <ArrowUpRight size={12} className="flex-none" />
          </a>
        ) : <span className="text-xs text-dim" title="链接协议不受支持">{url}</span>
      })() : null}
      {preview ? (
        <div className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-2xs leading-relaxed text-dim">{preview}</div>
      ) : null}
    </div>
  )
}

function JsonBody({ payload }: { payload: Record<string, unknown> }): React.ReactElement {
  const text = payload.text ?? payload.markdown ?? payload.body
  if (typeof text === "string" && text) return <div className="p-2.5"><Markdown text={text} /></div>
  return (
    <div className="codeblock-body overflow-x-auto p-2.5 text-2xs leading-relaxed">
      <pre className="whitespace-pre-wrap break-all font-mono text-dim">{JSON.stringify(payload, null, 2)}</pre>
    </div>
  )
}

export function PanelCard({ panel }: { panel: PanelInfo }): React.ReactElement {
  const body =
    panel.kind === "diff" ? <DiffBody payload={panel.payload} />
    : panel.kind === "image" ? <ImageBody payload={panel.payload} />
    : panel.kind === "table" ? <TableBody payload={panel.payload} />
    : panel.kind === "url" ? <UrlBody payload={panel.payload} />
    : panel.kind === "markdown" ? <JsonBody payload={panel.payload} />
    : <JsonBody payload={panel.payload} />
  return (
    <div className="card overflow-hidden !p-0">
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5 text-2xs font-medium text-dim">
        <span className="text-faint">{KIND_ICON[panel.kind] ?? <Braces size={13} />}</span>
        <span className="truncate">{panel.title ?? panel.kind}</span>
        <span className="ml-auto flex-none rounded border border-line px-1 text-2xs uppercase tracking-wide text-ghost">{panel.kind}</span>
      </div>
      {body}
    </div>
  )
}
