/**
 * Transcript — high-end chat stream:
 * - Empty State: exclusive celestial hero planetary Emo Ball (floating gentle,
 *   full interactive animation, planetary orbit ring, starter prompt pills)
 * - User Message: modern clean bubble with subtle card elevation & avatar
 * - Assistant Output: pro typography ladder, sleek tool capsules, codeblocks
 * - Seamless live-to-history transition with no duplicate cards
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Brain,
  ChevronDown,
  Code2,
  Compass,
  FileDiff,
  FileText,
  Globe,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react"
import { api } from "../api/client"
import {
  foldTranscript,
  imageUrl,
  prettyTitle,
  toolSummary,
  type FileChange,
  type ToolBlock,
  type TurnBlock,
  type UserTurn,
} from "../api/fold"
import type { StoredEventRow } from "../api/types"
import { useBus } from "../api/bus"
import { useApp, useStream, type LiveTurn } from "../state/store"
import { EmptyState, Spinner } from "./ui"
import { Markdown } from "./Markdown"
import { PanelCard } from "./PanelCard"
import { EmotionBall } from "./EmotionBall"

// ---------- Tool icon mapping ----------
function getToolIcon(name: string): React.ReactElement {
  const lc = name.toLowerCase()
  if (lc.includes("bash") || lc.includes("command")) return <Terminal size={12} className="text-amber-500" />
  if (lc.includes("search")) return <Globe size={12} className="text-sky-400" />
  if (lc.includes("read") || lc.includes("file")) return <FileText size={12} className="text-indigo-400" />
  if (lc.includes("edit") || lc.includes("write")) return <Code2 size={12} className="text-emerald-400" />
  return <Wrench size={12} className="text-dim" />
}

// ---------- Tool row (sleek capsule -> terminal drop) ----------

function ToolRow({
  name,
  summary,
  output,
  isError,
  pending,
}: {
  name: string
  summary: string
  output?: string
  isError?: boolean
  pending?: boolean
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const hasOutput = output !== undefined

  return (
    <div className="my-1 min-w-0">
      <button
        onClick={() => hasOutput && setOpen((v) => !v)}
        className={`tool-capsule ${isError ? "!border-bad/40 !bg-bad/5 text-bad" : ""}`}
        title={hasOutput ? (open ? "点击折叠输出" : "点击展开输出") : "工具运行中…"}
      >
        {pending ? <Spinner size={11} className="text-accent" /> : getToolIcon(name)}
        <span className="font-medium text-fg">{name}</span>
        <span className="max-w-xs truncate text-faint">{summary}</span>
        {isError && <span className="rounded bg-bad/15 px-1.5 py-0.5 text-2xs text-bad">失败</span>}
        {hasOutput && (
          <ChevronDown
            size={11}
            className={`flex-none text-ghost transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && hasOutput && (
        <div className="pop-in codeblock-body mt-1.5 max-h-72 overflow-auto rounded-xl border border-line bg-bg2 p-3 text-2xs leading-relaxed shadow-sm">
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

// ---------- Thinking block ----------

function ThinkingBlock({ text, live }: { text: string; live?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (live) setOpen(true)
  }, [live])

  return (
    <div className="my-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line/60 bg-hover/40 px-2 py-1 text-2xs text-faint transition-colors hover:text-dim"
      >
        <Brain size={12} className="text-purple-400/80" />
        <span>思考过程{live ? "…" : ""}</span>
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pop-in mt-1.5 whitespace-pre-wrap rounded-xl border-l-2 border-purple-400/40 bg-hover/20 p-3 text-xs leading-relaxed text-dim/90 shadow-sm">
          {text}
        </div>
      )}
    </div>
  )
}

// ---------- File changes ----------

function ChangeList({ changes }: { changes: FileChange[] }): React.ReactElement | null {
  const [open, setOpen] = useState<string | null>(null)
  if (changes.length === 0) return null

  return (
    <div className="my-2 flex flex-col gap-1">
      {changes.map((c) => (
        <div key={c.path} className="min-w-0">
          <button
            onClick={() => setOpen(open === c.path ? null : c.path)}
            className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hover"
          >
            <FileDiff size={12} className="flex-none text-accent" />
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

// ---------- General blocks ----------

function BlockView({
  b,
  streaming,
}: {
  b: TurnBlock | { kind: "note"; text: string; variant: string }
  streaming?: boolean
}): React.ReactElement | null {
  if (b.kind === "text") return <Markdown text={b.text} streaming={streaming} />
  if (b.kind === "thinking") return <ThinkingBlock text={b.text} live={streaming} />
  if (b.kind === "panel") {
    return (
      <div className="my-2.5">
        <PanelCard panel={b.panel} />
      </div>
    )
  }
  if (b.kind === "note") {
    const tone = b.variant === "error" ? "text-bad" : b.variant === "steer" ? "text-accent" : "text-faint"
    return (
      <div className={`my-1 flex items-start gap-1.5 text-xs ${tone}`}>
        <span className="mt-0.5 flex-none font-mono">›</span>
        <span className="min-w-0 break-words">{b.text}</span>
      </div>
    )
  }
  return null
}

// ---------- User Turn ----------

function UserTurnView({ turn }: { turn: UserTurn }): React.ReactElement {
  return (
    <div className="fade-up my-4 flex flex-col items-end gap-2">
      <div className="flex max-w-[88%] items-start gap-2.5">
        <div className="user-bubble min-w-0">
          {turn.text ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg select-text">{turn.text}</div>
          ) : null}
          {turn.images && turn.images.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {turn.images.map((img, i) => (
                <img
                  key={i}
                  src={imageUrl(img)}
                  alt=""
                  className="max-h-48 rounded-xl border border-line object-contain shadow-sm"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Assistant Turn (History) ----------

function AssistantTurnView({ turn }: { turn: UserTurn }): React.ReactElement | null {
  const hasContent = turn.blocks.length > 0 || turn.panels.length > 0 || turn.changes.length > 0
  if (!hasContent) return null

  return (
    <div className="fade-up my-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-2xs font-medium text-faint">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/15 text-accent ring-1 ring-accent/30">
          <Sparkles size={10} />
        </span>
        <span className="font-semibold text-fg">newhorse</span>
      </div>

      <div className="assistant-bubble min-w-0 pl-1">
        {turn.blocks.map((b, i) =>
          b.kind === "tool" ? (
            <ToolBlockView key={i} b={b} />
          ) : (
            <BlockView key={i} b={b} />
          ),
        )}
      </div>

      <ChangeList changes={turn.changes} />
    </div>
  )
}

// ---------- Live Turn (User Bubble first, then streaming assistant reply) ----------

function LiveTurnView({ turn }: { turn: LiveTurn }): React.ReactElement {
  const lastText = [...turn.blocks].reverse().find((b) => b.kind === "text")

  return (
    <div className="fade-up my-4 flex flex-col gap-2.5">
      {/* 1. Immediate User Question Bubble (renders instantly upon send) */}
      {turn.userPrompt && (
        <div className="my-2 flex flex-col items-end gap-2">
          <div className="flex max-w-[88%] items-start gap-2.5">
            <div className="user-bubble min-w-0">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg select-text">{turn.userPrompt}</div>
              {turn.images && turn.images.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {turn.images.map((img, i) => (
                    <img
                      key={i}
                      src={imageUrl(img)}
                      alt=""
                      className="max-h-48 rounded-xl border border-line object-contain shadow-sm"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Assistant Streaming Reply */}
      <div className="flex items-center gap-2 text-2xs font-medium text-faint">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 text-accent ring-1 ring-accent/40 animate-pulse">
          <Sparkles size={10} />
        </span>
        <span className="font-semibold text-fg">newhorse</span>
        {turn.busy && <span className="text-ghost">· 正在生成…</span>}
      </div>

      <div className="assistant-bubble min-w-0 pl-1">
        {turn.blocks.map((b, i) => {
          if (b.kind === "tool") {
            return (
              <ToolBlockView
                key={i}
                b={{ kind: "tool", name: b.name, input: b.input, output: b.output, isError: b.isError }}
                pending={b.output === undefined}
              />
            )
          }
          const streaming = b.kind === "thinking" || b === lastText
          return <BlockView key={i} b={b} streaming={streaming || undefined} />
        })}
      </div>

      {turn.panels.map((p) => (
        <PanelCard key={p.panelId} panel={p} />
      ))}
    </div>
  )
}

// ---------- The Transcript Component ----------

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

  // Bus refresh on turn settlement / tool / step events
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

  // Settled locally-initiated turn: refetch log first, then drop live turn
  useEffect(() => {
    if (!settled) return
    let alive = true
    void (async () => {
      await load()
      if (alive && liveTurn) dismiss(sessionId, liveTurn.startedAt)
    })()
    return () => {
      alive = false
    }
  }, [settled, sessionId, load, dismiss])

  const items = useMemo(() => foldTranscript(events ?? []), [events])

  // --- Auto scroll ---
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sticky, setSticky] = useState(true)
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setSticky(el.scrollHeight - el.scrollTop - el.clientHeight < 120)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !sticky) return
    el.scrollTop = el.scrollHeight
  })

  const row = sessions.find((s) => s.sessionId === sessionId)
  const title = row ? (row.role === "butler" ? "newhorse" : prettyTitle(row.title, "未命名会话")) : sessionId.slice(0, 12)
  const empty = !loading && !error && events !== null && events.length <= 1 && !liveTurn

  const onSelectPrompt = (promptText: string): void => {
    window.dispatchEvent(new CustomEvent("nh-fill-prompt", { detail: promptText }))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sleek Header Bar */}
      <div className="flex flex-none items-center justify-between border-b border-line bg-panel/60 px-6 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`dot flex-none ${
              liveTurn?.busy || row?.status === "active"
                ? "dot-active"
                : row?.status === "interrupted"
                ? "dot-error"
                : "dot-settled"
            }`}
          />
          <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight text-fg">{title}</h1>
        </div>
      </div>

      {/* Main chat stream container (responsive wide for 2K & ultrawide) */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-4xl lg:max-w-5xl 2xl:max-w-6xl flex-col px-4 sm:px-6 lg:px-8 py-8">
            {loading && (
              <div className="flex justify-center py-16">
                <Spinner size={20} />
              </div>
            )}

            {error && (
              <EmptyState
                title="转录加载失败"
                hint={error}
                action={
                  <button className="btn mt-2" onClick={() => void load()}>
                    重试
                  </button>
                }
              />
            )}

            {/* Exclusive Planetary Hero Empty State — only place with the live Emo Ball */}
            {empty && (
              <div className="pop-in my-auto flex flex-col items-center py-12 text-center">
                <div className="float-gentle mb-4">
                  <EmotionBall mood="listening" size={136} interactive hasRing />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-fg">newhorse 随时就绪</h2>
                <p className="mt-1.5 max-w-md text-xs leading-relaxed text-dim">
                  模型无关的智能体引擎。支持调用工具、读写代码、检索网络并实时呈现可视化面板。
                </p>

                {/* Prompt starter pills */}
                <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                  <button
                    className="prompt-pill"
                    onClick={() => onSelectPrompt("请读取当前仓库结构，分析并总结代码工程模块。")}
                  >
                    <Compass size={13} className="text-accent" />
                    <span>读取当前仓库结构并总结</span>
                  </button>
                  <button
                    className="prompt-pill"
                    onClick={() =>
                      onSelectPrompt("请使用 web_search 检索最新的 LLM Agent 架构发展趋势并列出要点。")
                    }
                  >
                    <Globe size={13} className="text-sky-400" />
                    <span>检索前沿 Agent 架构趋势</span>
                  </button>
                  <button
                    className="prompt-pill"
                    onClick={() =>
                      onSelectPrompt("请用规范的 Mermaid flowchart TD 语法绘制一个多代理协作拓扑图。")
                    }
                  >
                    <Code2 size={13} className="text-emerald-400" />
                    <span>绘制多 Agent 架构拓扑图</span>
                  </button>
                </div>
              </div>
            )}

            {/* Chat message stream */}
            {!loading &&
              !error &&
              items.map((it, i) =>
                it.kind === "user" ? (
                  <div key={`turn-${i}`}>
                    <UserTurnView turn={it} />
                    <AssistantTurnView turn={it} />
                  </div>
                ) : (
                  <BlockView key={`note-${i}`} b={it} />
                ),
              )}

            {liveTurn && <LiveTurnView turn={liveTurn} />}
            <div className="h-6 flex-none" />
          </div>
        </div>

        {/* Floating scroll to bottom anchor */}
        {!sticky && (
          <button
            className="pop-in btn absolute bottom-4 left-1/2 z-20 -translate-x-1/2 !bg-panel/95 !border-line-strong text-fg shadow-overlay backdrop-blur-md"
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
