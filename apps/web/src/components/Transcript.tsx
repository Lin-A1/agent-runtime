/**
 * Transcript — the folded event log + the live turn in one column. History
 * folds from GET /v1/session/:id/events; locally-initiated turns render from
 * the StreamProvider's live turn until the settled log refetch lands, then
 * the live turn is dismissed. Minimal version: conversation loop only
 * (send → stream → settle → history), no chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brain, ChevronDown, FileDiff, Wrench } from "lucide-react"
import { api } from "../api/client"
import { foldTranscript, imageUrl, prettyTitle, toolSummary, type FileChange, type ToolBlock, type TurnBlock, type UserTurn } from "../api/fold"
import type { StoredEventRow } from "../api/types"
import { useBus } from "../api/bus"
import { useApp, useStream, type LiveTurn } from "../state/store"
import { EmptyState, Spinner } from "./ui"
import { Markdown } from "./Markdown"
import { PanelCard } from "./PanelCard"
import { EmotionBall } from "./EmotionBall"

// ---------- tool row ----------

function ToolRow({ name, summary, output, isError, pending }: { name: string; summary: string; output?: string; isError?: boolean; pending?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0">
      <button
        onClick={() => output !== undefined && setOpen((v) => !v)}
        className={`flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
          isError ? "border-line bg-bad/5 text-fg" : "border-line bg-bg2 text-dim hover:bg-hover"
        }`}
      >
        {pending ? <Spinner size={12} /> : <Wrench size={12} className="flex-none text-faint" />}
        <span className="flex-none font-medium text-fg">{name}</span>
        <span className="min-w-0 flex-1 truncate text-faint">{summary}</span>
        {isError && <span className="flex-none rounded bg-bad/15 px-1.5 text-2xs text-bad">错误</span>}
        {output !== undefined && <ChevronDown size={12} className={`flex-none text-ghost transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && output !== undefined && (
        <div className="codeblock-body mt-1 max-h-72 overflow-auto rounded-lg p-2.5 text-2xs leading-relaxed">
          <pre className="whitespace-pre-wrap break-all font-mono text-dim">{output}</pre>
        </div>
      )}
    </div>
  )
}

function ToolBlockView({ b, pending }: { b: Omit<ToolBlock, "summary">; pending?: boolean }): React.ReactElement {
  const input = (b.input ?? {}) as Record<string, unknown>
  return <ToolRow name={b.name} summary={toolSummary(b.name, input)} output={b.output} isError={b.isError} pending={pending} />
}

// ---------- thinking ----------

function ThinkingBlock({ text, live }: { text: string; live?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (live) setOpen(true)
  }, [live])
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-2xs text-faint hover:text-dim">
        <Brain size={12} />
        <span>思考{live ? "中…" : "过程"}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 text-xs leading-relaxed text-faint">{text}</div>}
    </div>
  )
}

// ---------- per-turn file changes ----------

function ChangeList({ changes }: { changes: FileChange[] }): React.ReactElement | null {
  const [open, setOpen] = useState<string | null>(null)
  if (changes.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {changes.map((c) => (
        <div key={c.path} className="min-w-0">
          <button onClick={() => setOpen(open === c.path ? null : c.path)} className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-bg2 px-2.5 py-1.5 text-left text-xs hover:bg-hover">
            <FileDiff size={12} className="flex-none text-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-dim">{c.path}</span>
            <span className="flex-none font-mono text-2xs text-ok">+{c.added}</span>
            <span className="flex-none font-mono text-2xs text-bad">−{c.removed}</span>
          </button>
          {open === c.path && (
            <div className="codeblock-body mt-1 max-h-72 overflow-auto rounded-lg py-1 text-2xs leading-relaxed">
              {c.diff.map((d, i) => (
                <div key={i} className={`cline ${d.kind}`}>
                  <span className="whitespace-pre-wrap break-all">{d.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------- blocks ----------

function BlockView({ b, streaming }: { b: TurnBlock | { kind: "note"; text: string; variant: string }; streaming?: boolean }): React.ReactElement | null {
  if (b.kind === "text") return <Markdown text={b.text} streaming={streaming} />
  if (b.kind === "thinking") return <ThinkingBlock text={b.text} live={streaming} />
  if (b.kind === "note") {
    const tone = b.variant === "error" ? "text-bad" : b.variant === "steer" ? "text-accent" : "text-faint"
    return (
      <div className={`flex items-start gap-1.5 text-xs ${tone}`}>
        <span className="mt-0.5 flex-none">›</span>
        <span className="min-w-0 break-words">{b.text}</span>
      </div>
    )
  }
  return null
}

// ---------- user turn ----------

function UserTurnView({ turn }: { turn: UserTurn }): React.ReactElement {
  return (
    <div className="fade-up flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-hover-2 text-2xs font-semibold text-dim">你</div>
        <div className="min-w-0 flex-1">
          {turn.text ? <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{turn.text}</div> : null}
          {turn.images && turn.images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {turn.images.map((img, i) => (
                <img key={i} src={imageUrl(img)} alt="" className="max-h-40 rounded-lg border border-line object-contain" />
              ))}
            </div>
          )}
        </div>
      </div>
      {turn.blocks.length > 0 && (
        <div className="ml-3 flex flex-col gap-2.5 border-l border-line pl-3.5">
          {turn.blocks.map((b, i) => (b.kind === "tool" ? <ToolBlockView key={i} b={b} /> : <BlockView key={i} b={b} />))}
        </div>
      )}
      {turn.panels.length > 0 && (
        <div className="ml-3 flex flex-col gap-2 border-l border-line pl-3.5">
          {turn.panels.map((p) => (
            <PanelCard key={p.panelId} panel={p} />
          ))}
        </div>
      )}
      <div className="ml-3">
        <ChangeList changes={turn.changes} />
      </div>
    </div>
  )
}

// ---------- live turn ----------

function LiveTurnView({ turn }: { turn: LiveTurn }): React.ReactElement {
  const lastText = [...turn.blocks].reverse().find((b) => b.kind === "text")
  return (
    <div className="fade-up ml-3 flex flex-col gap-2.5 border-l border-line pl-3.5">
      {turn.blocks.map((b, i) => {
        if (b.kind === "tool") return <ToolBlockView key={i} b={{ kind: "tool", name: b.name, input: b.input, output: b.output, isError: b.isError }} pending={b.output === undefined} />
        const streaming = b.kind === "thinking" || b === lastText
        return <BlockView key={i} b={b} streaming={streaming || undefined} />
      })}
      {turn.panels.map((p) => (
        <PanelCard key={p.panelId} panel={p} />
      ))}
      {turn.busy && (
        <div className="flex items-center gap-2 text-xs text-faint">
          <Spinner size={12} />
          <span>生成中…</span>
        </div>
      )}
    </div>
  )
}

// ---------- the transcript ----------

export function Transcript({ sessionId }: { sessionId: string }): React.ReactElement {
  const { sessions } = useApp()
  const { live, dismiss } = useStream()

  const [events, setEvents] = useState<StoredEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const rows = await api.events(sessionId)
      setEvents(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    setLoading(true)
    setEvents(null)
    void load()
  }, [sessionId, load])

  // Other-writer refresh (CLI / butler / another tab): refetch this log.
  const lastLoad = useRef(0)
  useBus((frame) => {
    if (frame.sessionId !== sessionId) return
    const t = frame.event.type
    if (t === "tool" || t === "step" || t === "done" || t === "result" || t === "error" || t === "panel") {
      const now = Date.now()
      if (now - lastLoad.current < 800) return
      lastLoad.current = now
      void load()
    }
  })

  const liveTurn = live.get(sessionId)
  const settled = liveTurn !== undefined && !liveTurn.busy

  // Settled locally-initiated turn: refetch the log FIRST, then drop the live
  // turn — the folded history replaces it with no gap and no double render.
  useEffect(() => {
    if (!settled) return
    let alive = true
    void (async () => {
      await load()
      if (alive) dismiss(sessionId)
    })()
    return () => {
      alive = false
    }
  }, [settled, sessionId, load, dismiss])

  const items = useMemo(() => foldTranscript(events ?? []), [events])

  // --- auto scroll ---
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sticky, setSticky] = useState(true)
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setSticky(el.scrollHeight - el.scrollTop - el.clientHeight < 90)
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !sticky) return
    el.scrollTop = el.scrollHeight
  })

  const row = sessions.find((s) => s.sessionId === sessionId)
  const title = row ? (row.role === "butler" ? "newhorse" : prettyTitle(row.title, "未命名会话")) : sessionId.slice(0, 12)
  const empty = !loading && !error && events !== null && events.length <= 1 && !liveTurn

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={`dot ${liveTurn?.busy || row?.status === "active" ? "dot-active" : row?.status === "interrupted" ? "dot-error" : "dot-settled"}`} />
        <h1 className="min-w-0 truncate text-sm font-semibold text-fg">{title}</h1>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
            {loading && (
              <div className="flex justify-center py-10">
                <Spinner size={18} />
              </div>
            )}
            {error && <EmptyState title="转录加载失败" hint={error} action={<button className="btn" onClick={() => void load()}>重试</button>} />}
            {empty && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <EmotionBall mood="listening" size={110} lite />
                <div>
                  <p className="text-base font-semibold text-fg">有什么可以帮忙的？</p>
                  <p className="mt-1 text-xs text-faint">输入任务开始对话</p>
                </div>
              </div>
            )}
            {!loading && !error && items.map((it, i) => (it.kind === "user" ? <UserTurnView key={i} turn={it} /> : <BlockView key={i} b={it} />))}
            {liveTurn && <LiveTurnView turn={liveTurn} />}
            <div className="h-2 flex-none" />
          </div>
        </div>
        {!sticky && (
          <button
            className="btn absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-overlay"
            onClick={() => {
              const el = scrollRef.current
              if (el) el.scrollTop = el.scrollHeight
            }}
          >
            <ChevronDown size={13} /> 回到底部
          </button>
        )}
      </div>
    </div>
  )
}
