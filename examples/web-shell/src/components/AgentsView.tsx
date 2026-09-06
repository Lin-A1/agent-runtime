import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { api } from "../api/client"
import { useBus } from "../api/bus"
import { foldTranscript, prettyTitle } from "../api/fold"
import type { SessionRow, StoredEventRow } from "../api/types"
import { Markdown } from "./Markdown"
import { Spinner } from "./ui"

export function AgentsView({ children }: { children: SessionRow[] }) {
  const [selected, setSelected] = useState<string>()
  const child = children.find((row) => row.sessionId === selected)
  return <div className="workbench-resource-view workbench-scroll">
    {child ? <><div className="workbench-resource-toolbar"><button className="icon-btn" title="返回子智能体" onClick={() => setSelected(undefined)}><ArrowLeft size={16} /></button><span className="min-w-0 truncate text-sm">{prettyTitle(child.title, child.sessionId)}</span></div><ChildDetail key={child.sessionId} child={child} /></> : <div className="p-3">
      {children.length === 0 && <p className="py-6 text-center text-sm text-faint">暂无子智能体</p>}
      {children.map((row) => <button key={row.sessionId} className="mb-2 flex min-h-14 w-full flex-col gap-1 rounded-md border border-line p-3 text-left hover:bg-hover" onClick={() => setSelected(row.sessionId)}><span className="w-full truncate text-sm text-fg">{prettyTitle(row.title, row.sessionId)}</span><span className="w-full truncate text-xs text-dim">{row.status} · {row.model ?? "模型未记录"}</span></button>)}
    </div>}
  </div>
}

function ChildDetail({ child }: { child: SessionRow }) {
  const [events, setEvents] = useState<StoredEventRow[]>()
  const [error, setError] = useState<string>()
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    try {
      const rows = await api.events(child.sessionId)
      if (current !== generation.current) return
      setEvents(rows)
      setError(undefined)
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [child.sessionId])
  useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  useBus((frame) => { if (frame.sessionId === child.sessionId) void load() })
  const items = foldTranscript(events ?? [])
  return <div className="min-w-0 p-4">
    <div className="mb-4 flex items-center justify-between gap-2"><span className="min-w-0 break-words text-xs text-dim">{child.status} · {child.model ?? "模型未记录"}</span><button className="icon-btn" title="刷新子智能体" onClick={() => void load()}><RefreshCw size={14} /></button></div>
    {error && <p role="alert" className="mb-3 break-words text-sm text-bad">{error}</p>}
    {!events && !error && <Spinner size={18} />}
    {events && items.length === 0 && <p className="text-sm text-faint">暂无消息</p>}
    {items.map((item, index) => item.kind === "note" ? <p key={index} className="my-3 text-sm text-dim">{item.text}</p> : <section key={item.seq} className="mb-6 border-b border-line pb-4">
      <p className="mb-3 whitespace-pre-wrap break-words text-sm text-dim">{item.text}</p>
      {item.blocks.map((block, blockIndex) => block.kind === "text" ? <Markdown key={blockIndex} text={block.text} /> : block.kind === "tool" ? <details key={blockIndex} className="my-2 text-xs text-dim"><summary>{block.name}</summary><pre className="whitespace-pre-wrap break-words">{block.output ?? "等待结果"}</pre></details> : block.kind === "thinking" ? <details key={blockIndex} className="my-2 text-xs text-faint"><summary>思考</summary><Markdown text={block.text} /></details> : block.kind === "note" ? <p key={blockIndex} className="text-sm text-dim">{block.text}</p> : null)}
    </section>)}
  </div>
}
