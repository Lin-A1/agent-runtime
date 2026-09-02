/**
 * Session page — wide transcript column + collapsible right sidePane (the
 * §1.8 wide layout), header with the resident ball avatar, model, three-level
 * policy, interrupt / fork / copy-id, and the bottom dock: todo/goal card
 * above the composer. All data folds from the event log via the api stub.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  Copy,
  Download,
  GitFork,
  Layers,
  PanelRightOpen,
  RefreshCw,
  Shield,
  Zap,
  X,
} from "lucide-react"
import { api, streamPrompt } from "../api/client"
import { useBusRefresh } from "../api/bus"
import type { ChatImage, ContextView, GoalView, PolicyLevel, SessionRow, StoredEventRow, TodoItem } from "../api/types"
import { foldTodos, prettyTitle } from "../api/fold"

import { useApi } from "../lib/useApi"
import { EmotionBall } from "../components/EmotionBall"
import { Transcript } from "../components/Transcript"
import { SidePane } from "../components/SidePane"
import { TodoDock } from "../components/TodoDock"
import { Composer } from "../components/Composer"
import { AsyncRegion, EmptyState, ErrorState, Segmented } from "../components/ui"

const POLICY_LABEL: Record<PolicyLevel, string> = {
  strict: "标准",
  readonly: "只读规划",
  trusted: "自动执行",
}

export function SessionPage(): React.ReactElement {
  const { id: routeId } = useParams()
  // The side pane starts open on desktop, collapsed (a bottom sheet on demand)
  // on mobile where it would cover the whole conversation.
  const [paneOpen, setPaneOpen] = useState<boolean>(() => typeof window === "undefined" || window.innerWidth >= 768)
  const [paneWidth, setPaneWidth] = useState(340)
  const [policy, setPolicy] = useState<PolicyLevel>("strict")
  // Live tail while a prompt streams: text/reasoning deltas + running tools.
  // On settle the transcript refolds from the log — the stream buffer clears.
  const [stream, setStream] = useState<{ text: string; reasoning: string; tools: string[] } | null>(null)
  const streamAbort = useRef<AbortController | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [forkOpen, setForkOpen] = useState(false)
  const navigate = useNavigate()
  // Shell-stage local echo: sends append a synthetic Prompted turn so the
  // conversation is live even before wiring day. The synthetic rows are
  // ordinary StoredEventRows — the fold renders them like any other turn.
  const [localTurns, setLocalTurns] = useState<StoredEventRow[]>([])

  const sessions = useApi<SessionRow[]>(() => api.sessions(), [])
  // The resident session id is engine-derived — resolve it from the list.
  const butlerId = sessions.data?.find((r) => r.role === "butler")?.sessionId
  const id = routeId ?? butlerId
  const idStr = id ?? ""
  const session = useMemo(() => (id ? sessions.data?.find((s) => s.sessionId === id) ?? null : null), [sessions.data, id])
  const events = useApi<StoredEventRow[]>(() => (id ? api.events(id) : Promise.resolve([])), [id])
  // Local turns ride AFTER the log rows (synthetic seqs sort last in practice).
  const mergedEvents = useMemo<StoredEventRow[]>(() => [...(events.data ?? []), ...localTurns], [events.data, localTurns])
  const goal = useApi<{ goal: GoalView | null }>(() => (id ? api.goal(id) : Promise.resolve({ goal: null, tokensUsed: 0 })), [id])
  const contextView = useApi<ContextView>(() => (id ? api.context(id) : Promise.resolve({ chars: 0, estTokens: 0 })), [id])
  const models = useApi<string[]>(() => api.models(), [])
  const settings = useApi(() => api.settings(), [])
  // 模型切换写 settings.model（全局默认）——正在运行的会话保持其捕获的模型，
  // 新会话生效（与设置页语义一致）。
  const applyModel = (m: string): void => {
    void api.putSettings({ model: m }).then(() => sessions.retry()).catch((e) => setStreamError(e.message))
  }

  // Durable policy: load the session's level, switch persists via POST /policy.
  // Keep the previous value while loading — resetting to a hardcoded default
  // flashes the wrong label on session switch.
  useEffect(() => {
    if (!id) return
    let alive = true
    void api.policy(id).then((r) => {
      if (alive) setPolicy(r.policy)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [id])

  // Abort the in-flight stream when the session changes or the page unmounts —
  // deltas from the previous session must not land in the new transcript.
  useEffect(() => {
    return () => {
      streamAbort.current?.abort()
    }
  }, [id])
  const changePolicy = (p: PolicyLevel): void => {
    setPolicy(p)
    if (id) void api.setPolicy(id, p).then(() => sessions.retry()).catch((e) => setStreamError(e.message))
  }

  // Global bus tail: turns started elsewhere (another tab / mobile / steer /
  // DAG nodes) land in the same log — refold on non-delta frames. Settle
  // frames also refresh the context strip and goal budget.
  useBusRefresh(
    (f) => f.sessionId === id,
    () => {
      events.retry()
      contextView.retry()
      goal.retry()
      sessions.retry()
    },
    1_500,
  )

  // Draft handoff from the cover: consume once per mount so a reload doesn't
  // resurrect a stale draft.
  const [initialText] = useState(() => {
    const d = sessionStorage.getItem("nh-draft") ?? ""
    if (d) sessionStorage.removeItem("nh-draft")
    return d
  })

  const todos = useMemo<TodoItem[]>(() => foldTodos(mergedEvents), [mergedEvents])
  const busy = session?.status === "active" || stream !== null
  const isButler = session?.role === "butler"

  // Chat convention: land on the latest turn when the log first loads.
  const scrollRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  useEffect(() => {
    didInitialScroll.current = false
  }, [id])
  useEffect(() => {
    if (didInitialScroll.current || !events.data || !scrollRef.current) return
    didInitialScroll.current = true
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [events.data])
  // Follow new local turns too (send echo).
  const localCount = localTurns.length
  useEffect(() => {
    if (localCount === 0 || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [localCount])

  const sendPrompt = (text: string, images?: ChatImage[]): void => {
    if (!id) return
    setStreamError(null)
    // 新鲜状态优先于渲染闭包：流已在跑（streamAbort 非空）就走 steer，
    // 不起第二条流——busy 只是渲染时快照，runCommand 回调里可能已过期。
    if (busy || streamAbort.current !== null) {
      // Mid-turn: durable steer — the running drain promotes it at the next
      // safe boundary; the transcript refolds from the log.
      void api.steer(id, text).then(() => events.retry()).catch((e) => setStreamError(e.message))
      return
    }
    const abort = new AbortController()
    streamAbort.current = abort
    setStream({ text: "", reasoning: "", tools: [] })
    streamPrompt(
      id,
      text,
      {
        signal: abort.signal,
        onEvent: (ev) => {
          if (ev.type === "text") setStream((s) => (s ? { ...s, text: s.text + ev.text } : s))
          else if (ev.type === "reasoning") setStream((s) => (s ? { ...s, reasoning: s.reasoning + ev.text } : s))
          else if (ev.type === "tool") setStream((s) => (s ? { ...s, tools: [...s.tools, ev.name] } : s))
        },
      },
      images,
    )
      .then(() => {
        streamAbort.current = null
        setStream(null)
        events.retry()
        sessions.retry()
        // 通知 (#18): 页面不可见时弹系统通知（需要授权；拒绝则静默降级）。
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          new Notification("newhorse 回合完成", { body: text.slice(0, 80) })
        }
      })
      .catch((e) => {
        streamAbort.current = null
        setStream(null)
        const msg = e instanceof Error ? e.message : String(e)
        if (!abort.signal.aborted) setStreamError(msg)
        events.retry()
        // Error notification (#18 matrix)
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          new Notification("newhorse 回合出错", { body: msg.slice(0, 120) })
        }
      })
  }

  const handleSend = (text: string, images?: ChatImage[]): void => {
    if (!id) return
    setStreamError(null)
    // 斜杠命令：展开文本（POST /command）就是发给模型的提示词——命令不是
    // 本地回显，而是真实进入回合（claude code 语义）。
    if (text.startsWith("/")) {
      void api.runCommand(id, text)
        .then((r) => {
          if (typeof r.output === "string" && r.output.trim()) sendPrompt(r.output.trim(), images)
        })
        .catch((e) => setStreamError(e instanceof Error ? e.message : String(e)))
      return
    }
    sendPrompt(text, images)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* center column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="flex flex-none items-center gap-3 border-b border-line px-5 py-2.5">
          {isButler ? (
            <EmotionBall mood={busy ? "thinking" : "idle"} size={30} lite />
          ) : (
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-line bg-bg2 text-dim">
              <Zap size={14} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-fg">{prettyTitle(session?.title, isButler ? "newhorse 会话" : "会话")}</h1>
              {isButler && <span className="chip !py-0 !text-[10px]">常驻</span>}
              {busy && (
                <span className="flex items-center gap-1.5 text-2xs text-warn">
                  <span className="dot dot-active" /> 运行中
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-2xs text-faint">
              <span className="truncate">{session?.model ?? "—"}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden truncate sm:inline">{id}</span>
              <button
                className="hidden text-ghost hover:text-dim sm:inline-flex"
                title="复制会话 ID"
                onClick={() => void navigator.clipboard?.writeText(idStr).catch(() => {})}
              >
                <Copy size={11} />
              </button>
            </div>
          </div>

          {/* policy + secondary actions: desktop only — mobile keeps a single
              sheet toggle, the rest moves into the desktop rail/menu */}
          <div className="hidden items-center md:flex">
            <Segmented
              size="xs"
              value={policy}
              onChange={changePolicy}
              options={[
                { value: "strict", label: POLICY_LABEL.strict, title: "每次文件改动前询问" },
                { value: "readonly", label: POLICY_LABEL.readonly, title: "只读检查，先出计划" },
                { value: "trusted", label: POLICY_LABEL.trusted, title: "更少确认，自动编辑与执行" },
              ]}
            />
            <button
              className="icon-btn"
              title="压缩上下文（手动折叠头部为摘要）"
              disabled={busy}
              onClick={() => {
                void api.compact(idStr).then(() => events.retry()).catch(() => {})
              }}
            >
              <Layers size={15} />
            </button>
            <button className="icon-btn" title="从当前位置回退分叉（fork 继承工作区与角色）" onClick={() => setForkOpen(true)}>
              <GitFork size={15} />
            </button>
            <button className="icon-btn" title="导出转录为 Markdown" onClick={() => exportMd(idStr)}>
              <Download size={15} />
            </button>
            <button className="icon-btn" title="重载会话（从事件日志重折）" onClick={events.retry}>
              <RefreshCw size={15} />
            </button>
          </div>
          <button
            className="icon-btn !h-9 !w-9 md:!h-auto md:!w-auto"
            title={paneOpen ? "收起面板" : "展开工具 / 子代理 / 审批面板"}
            onClick={() => setPaneOpen((v) => !v)}
          >
            <PanelRightOpen size={16} style={{ transform: paneOpen ? undefined : "scaleX(-1)" }} />
          </button>
        </header>

        {/* context ratio strip — quiet, neutral fill; token count hidden on mobile */}
        {contextView.data && (
          <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-1.5 md:px-5">
            <Shield size={11} className="flex-none text-ghost" />
            <div className="h-1 w-16 overflow-hidden rounded-full bg-bg2 md:w-24">
              <div className="h-full rounded-full" style={{ width: `${(contextView.data.ratio ?? 0) * 100}%`, background: "var(--txt-ghost)" }} />
            </div>
            <span className="font-mono text-2xs text-ghost">
              上下文 {((contextView.data.ratio ?? 0) * 100).toFixed(0)}%
              <span className="hidden sm:inline"> · {contextView.data.estTokens.toLocaleString()} tokens</span>
            </span>
          </div>
        )}

        {/* transcript */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <AsyncRegion
            state={events}
            emptyIf={(evs) => evs.length === 0}
            empty={
              <EmptyState
                className="!py-24"
                icon={<Zap size={18} />}
                title="这个会话还没有对话"
                hint="在下方输入第一个任务。封面与侧栏的新任务都会进入当前工作区的常驻 newhorse 会话。"
              />
            }
          >
            {(evs) => (
              <Transcript
                events={[...evs, ...localTurns]}
                sessionId={idStr}
                onFork={(seq) => {
                  void api.forkSession(idStr, seq).then((r) => {
                    navigate(`/session/${r.sessionId}`)
                    sessions.retry()
                  })
                }}
              />
            )}
          </AsyncRegion>
        </div>

        {/* live tail while streaming (the log refolds on settle) */}
        {stream && (
          <div className="flex-none border-t border-line bg-panel px-4 py-2.5">
            {stream.reasoning && <p className="mb-1 line-clamp-2 text-2xs italic text-ghost">{stream.reasoning.slice(-200)}</p>}
            {stream.tools.map((t, i) => (
              <div key={i} className="text-2xs text-dim">⚙ {t}</div>
            ))}
            {stream.text && <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{stream.text}</p>}
            <p className="mt-1 flex items-center gap-1.5 text-2xs text-ghost"><span className="dot dot-active" /> 流式生成中——完成后转录将从事件日志重折</p>
          </div>
        )}
        {streamError && (
          <div className="flex-none border-t border-line bg-panel px-4 py-2 text-2xs text-bad">发送失败：{streamError}</div>
        )}
        {/* dock: todos + composer */}
        <div className="flex-none border-t border-line bg-bg px-3 py-2.5 md:px-5 md:py-3" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto w-full max-w-[860px]">
            {/* todos collapsed by default on mobile to leave room for input */}
            <div className="mb-2 hidden sm:block">
              <TodoDock todos={todos} goal={goal.data?.goal ?? null} />
            </div>
            <Composer
              key={idStr}
              initialText={initialText}
              busy={busy}
              model={session?.model ?? settings.data?.model ?? ""}
              onInterrupt={() => {
                streamAbort.current?.abort()
                void api.interrupt(idStr)
              }}
              onSend={handleSend}
              placeholder={busy ? "回合进行中——发送将作为追加（steer）" : "给 newhorse 发任务…"}
              models={models.data ?? []}
              onModelChange={applyModel}
            />
            {/* kbd/shortcut hint: desktop only (saves vertical space on mobile) */}
            <div className="mt-1.5 hidden items-center justify-end px-1 text-2xs text-ghost md:flex">
              <span>策略：{POLICY_LABEL[policy]} · <span className="kbd">Ctrl</span>+<span className="kbd">K</span> 命令面板</span>
            </div>
          </div>
        </div>
      </div>

      {/* mobile scrim for the bottom sheet */}
      {paneOpen && <div className="fixed inset-0 z-30 md:hidden" style={{ background: "var(--scrim)" }} onClick={() => setPaneOpen(false)} />}

      {forkOpen && <ForkModal sessionId={idStr} events={mergedEvents} onClose={() => setForkOpen(false)} />}
      {/* right sidePane */}
      {paneOpen && (
        <SidePane
          sessionId={idStr}
          workspace={session?.workspace ?? ""}
          events={events.data ?? []}
          contextView={contextView.data ?? null}
          goal={goal.data?.goal ?? null}
          onClose={() => setPaneOpen(false)}
          width={paneWidth}
          onResize={setPaneWidth}
        />
      )}
    </div>
  )
}


/** 导出转录为 Markdown（#23）: foldTranscript → 文本, Blob 下载。走 api.events
 *  （带 baseUrl + Bearer），不再裸 fetch。 */
function exportMd(sessionId: string): void {
  void api.events(sessionId)
    .then((rows: StoredEventRow[]) => {
      return import("../api/fold").then(({ foldTranscript }) => {
        const turns = foldTranscript(rows)
        const parts: string[] = [`# newhorse 转录 — ${sessionId}`, ""]
        for (const it of turns) {
          if (it.kind !== "user") continue
          parts.push(`## 🖊 ${it.text}`, "")
          for (const b of it.blocks) {
            if (b.kind === "text") parts.push(b.text, "")
            else if (b.kind === "thinking") parts.push("> 思考：" + b.text, "")
            else if (b.kind === "tool") parts.push("`[" + b.name + "]` " + b.summary, "")
            else if (b.kind === "note") parts.push("*" + b.text + "*", "")
          }
          for (const c of it.changes) parts.push("**" + c.path + "** +" + c.added + " −" + c.removed, "")
        }
        const blob = new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" })
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = `newhorse-${sessionId}.md`
        a.click()
        URL.revokeObjectURL(a.href)
      })
    })
    .catch((e) => window.alert("导出失败：" + (e instanceof Error ? e.message : String(e))))
}
/** Fork 表单（wave 8）：列出用户轮（每条的 seq 就是 fork 点），选一条 →
 *  POST /v1/session/:id/fork {atSeq} → 跳转到新会话（继承工作区与角色）。 */
function ForkModal({
  sessionId,
  events,
  onClose,
}: { sessionId: string; events: StoredEventRow[]; onClose: () => void }): React.ReactElement {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const turns = useMemo(() => {
    const rows = events.filter((e) => e.type === "Session.Prompted")
    return rows.map((r) => ({ seq: r.seq, prompt: String((r.data as { prompt?: string }).prompt ?? "").slice(0, 60) }))
  }, [events])
  const doFork = (atSeq?: number): void => {
    setBusy(true)
    void api.forkSession(sessionId, atSeq)
      .then((r) => {
        onClose()
        navigate(`/session/${r.sessionId}`)
      })
      .catch(() => setBusy(false))
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "var(--scrim)" }} onMouseDown={onClose}>
      <div className="card flex max-h-[70vh] w-full max-w-[480px] flex-col overflow-hidden" style={{ maxWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">从历史轮次分叉</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-2 pb-2 text-2xs leading-relaxed text-faint">选定一条用户消息作为分叉点——新会话复制该点之前（含）的全部事件，继承工作区与角色。</p>
          {turns.length === 0 && <div className="px-2 py-4 text-center text-2xs text-ghost">还没有可分叉的用户轮次</div>}
          {turns.map((t) => (
            <button
              key={t.seq}
              disabled={busy}
              onClick={() => doFork(t.seq)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-dim hover:bg-hover hover:text-fg"
            >
              <GitFork size={12} className="flex-none text-faint" />
              <span className="min-w-0 flex-1 truncate">{t.prompt}</span>
              <span className="flex-none font-mono text-2xs text-ghost">seq {t.seq}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-line px-4 py-2.5">
          <button className="btn w-full" disabled={busy} onClick={() => doFork(undefined)}>
            不选分叉点——从当前头部分叉
          </button>
        </div>
      </div>
    </div>
  )
}