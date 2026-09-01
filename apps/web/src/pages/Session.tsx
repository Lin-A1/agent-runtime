/**
 * Session page — wide transcript column + collapsible right sidePane (the
 * §1.8 wide layout), header with the resident ball avatar, model, three-level
 * policy, interrupt / fork / copy-id, and the bottom dock: todo/goal card
 * above the composer. All data folds from the event log via the api stub.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import {
  Copy,
  GitFork,
  PanelRightOpen,
  RefreshCw,
  Shield,
  Zap,
} from "lucide-react"
import { api } from "../api/client"
import type { ContextView, GoalView, PolicyLevel, SessionRow, StoredEventRow, TodoItem } from "../api/types"
import { foldTodos, prettyTitle } from "../api/fold"
import { WS_NH, BUTLER_NH } from "../fixtures/sessions"
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
  const { id = BUTLER_NH } = useParams()
  // The side pane starts open on desktop, collapsed (a bottom sheet on demand)
  // on mobile where it would cover the whole conversation.
  const [paneOpen, setPaneOpen] = useState<boolean>(() => typeof window === "undefined" || window.innerWidth >= 768)
  const [policy, setPolicy] = useState<PolicyLevel>("strict")

  const sessions = useApi<SessionRow[]>(() => api.sessions(WS_NH), [])
  const session = useMemo(() => sessions.data?.find((s) => s.sessionId === id) ?? null, [sessions.data, id])
  const events = useApi<StoredEventRow[]>(() => api.events(id), [id])
  const goal = useApi<{ goal: GoalView | null }>(() => api.goal(id), [id])
  const contextView = useApi<ContextView>(() => api.context(id), [id])

  const todos = useMemo<TodoItem[]>(() => (events.data ? foldTodos(events.data) : []), [events.data])
  const busy = session?.status === "active"
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
                onClick={() => void navigator.clipboard?.writeText(id).catch(() => {})}
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
              onChange={setPolicy}
              options={[
                { value: "strict", label: POLICY_LABEL.strict, title: "每次文件改动前询问" },
                { value: "readonly", label: POLICY_LABEL.readonly, title: "只读检查，先出计划" },
                { value: "trusted", label: POLICY_LABEL.trusted, title: "更少确认，自动编辑与执行" },
              ]}
            />
            <button className="icon-btn" title="从当前位置回退分叉（fork 继承工作区与角色）">
              <GitFork size={15} />
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
            {(evs) => <Transcript events={evs} sessionId={id} />}
          </AsyncRegion>
        </div>

        {/* dock: todos + composer */}
        <div className="flex-none border-t border-line bg-bg px-3 py-2.5 md:px-5 md:py-3">
          <div className="mx-auto w-full max-w-[860px]">
            {/* todos collapsed by default on mobile to leave room for input */}
            <div className="mb-2 hidden sm:block">
              <TodoDock todos={todos} goal={goal.data?.goal ?? null} />
            </div>
            <Composer busy={busy} onInterrupt={() => void api.interrupt(id)} placeholder={busy ? "回合进行中——发送将作为追加（steer）" : "给 newhorse 发任务…"} />
            {/* kbd/shortcut hint: desktop only (saves vertical space on mobile) */}
            <div className="mt-1.5 hidden items-center justify-end px-1 text-2xs text-ghost md:flex">
              <span>策略：{POLICY_LABEL[policy]} · <span className="kbd">Ctrl</span>+<span className="kbd">K</span> 命令面板</span>
            </div>
          </div>
        </div>
      </div>

      {/* mobile scrim for the bottom sheet */}
      {paneOpen && <div className="fixed inset-0 z-30 md:hidden" style={{ background: "var(--scrim)" }} onClick={() => setPaneOpen(false)} />}

      {/* right sidePane */}
      {paneOpen && (
        <SidePane
          sessionId={id}
          workspace={session?.workspace ?? WS_NH}
          events={events.data ?? []}
          contextView={contextView.data ?? null}
          goal={goal.data?.goal ?? null}
          onClose={() => setPaneOpen(false)}
        />
      )}
    </div>
  )
}
