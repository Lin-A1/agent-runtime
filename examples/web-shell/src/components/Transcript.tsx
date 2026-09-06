/**
 * Transcript — High-end chat stream:
 * - Empty State: exclusive celestial hero planetary Emo Ball (floating gentle,
 *   full interactive animation, planetary orbit ring, starter prompt pills),
 *   with centered hero Composer on Desktop.
 * - Mobile: Fixed bottom dock composer, off-canvas mobile drawer trigger
 * - User Message: modern clean bubble with subtle elevation
 * - Assistant Output: ToolTrace & ThinkingTrace ported from BeautifulUI, ChangeList git diffs
 * - Live Generation: dynamic live Emo Ball avatar reflecting real-time agent mood
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { useNavigate } from "react-router-dom"
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Compass,
  Copy,
  Folder,
  GitBranch,
  Globe,
  Menu,
  PanelRight,
  Pencil,
  Plus,
  Undo2,
} from "lucide-react"
import { api } from "../api/client"
import {
  fmtClock,
  foldTranscript,
  imageUrl,
  prettyTitle,
  toolSummary,
  type ToolBlock,
  type TurnBlock,
  type UserTurn,
} from "../api/fold"
import type { StoredEventRow } from "../api/types"
import { useBus } from "../api/bus"
import { useApp, useStream, type LiveBlock, type LiveTurn } from "../state/store"
import { EmptyState, Spinner } from "./ui"
import { Markdown } from "./Markdown"
import { PanelCard } from "./PanelCard"
import { EmotionBall, type BallMood } from "./EmotionBall"
import { ToolTrace } from "./ToolTrace"
import { ThinkingTrace } from "./ThinkingTrace"
import { ChangeList } from "./ChangeList"
import { Composer } from "./Composer"
import { WorkbenchPane } from "./WorkbenchPane"
import { WorkspacePulse } from "./WorkspacePulse"
import { deriveSessionActivity } from "../workbench/activity"
import { useSessionContext } from "../workbench/hooks"
import { ContextToolGroup, isContextTool } from "./ContextToolGroup"
import { TurnFooter } from "./TurnFooter"
import { PixelLoader } from "./PixelLoader"
import { useMediaQuery } from "../lib/useMediaQuery"
import { ApprovalDock } from "./ApprovalDock"

// ---------- Group consecutive context-gathering tools into a single group ----------
type GroupedBlock =
  | { kind: "block"; b: TurnBlock }
  | { kind: "context-group"; tools: ToolBlock[] }

function groupBlocks(blocks: TurnBlock[]): GroupedBlock[] {
  const result: GroupedBlock[] = []
  let contextBuffer: ToolBlock[] = []

  const flush = (): void => {
    if (contextBuffer.length === 0) return
    result.push({ kind: "context-group", tools: contextBuffer })
    contextBuffer = []
  }

  for (const b of blocks) {
    if (b.kind === "tool" && isContextTool(b.name)) {
      contextBuffer.push(b)
    } else {
      flush()
      result.push({ kind: "block", b })
    }
  }
  flush()
  return result
}

/** A lone context tool reads better as a plain row (读取 xxx / 搜索 xxx) than
 *  as a one-item "已搜集上下文" group — the wrapper only earns its keep at 2+. */
function compactSingletonGroups(groups: GroupedBlock[]): GroupedBlock[]
function compactSingletonGroups(groups: GroupedLiveBlock[]): GroupedLiveBlock[]
/** A lone context tool reads better as a plain row (读取 xxx / 搜索 xxx) than
 *  as a one-item "已搜集上下文" group — the wrapper only earns its keep at 2+. */
function compactSingletonGroups(
  groups: Array<{ kind: "block"; b: unknown } | { kind: "context-group"; tools: unknown[] }>,
): unknown[] {
  return groups.flatMap((g) => {
    if (g.kind === "context-group" && g.tools.length === 1) {
      return [{ kind: "block" as const, b: g.tools[0]! }]
    }
    return [g]
  })
}

type GroupedLiveBlock =
  | { kind: "block"; b: LiveBlock }
  | { kind: "context-group"; tools: Array<{ kind: "tool"; callId: string; name: string; input: unknown; output?: string; isError?: boolean; streaming?: boolean }> }

function groupLiveBlocks(blocks: LiveBlock[]): GroupedLiveBlock[] {
  const result: GroupedLiveBlock[] = []
  let contextBuffer: Array<{ kind: "tool"; callId: string; name: string; input: unknown; output?: string; isError?: boolean; streaming?: boolean }> = []

  const flush = (): void => {
    if (contextBuffer.length === 0) return
    result.push({ kind: "context-group", tools: contextBuffer })
    contextBuffer = []
  }

  for (const b of blocks) {
    if (b.kind === "tool" && isContextTool(b.name)) {
      contextBuffer.push(b)
    } else {
      flush()
      result.push({ kind: "block", b })
    }
  }
  flush()
  return result
}

// ---------- Infer real-time Live Mood from agent execution blocks ----------
function inferLiveMood(turn: LiveTurn): BallMood {
  if (turn.error) return "error"
  if (!turn.busy) return "done"
  const lastBlock = turn.blocks[turn.blocks.length - 1]
  if (!lastBlock) return "receiving"
  if (lastBlock.kind === "thinking") return "thinking"
  if (lastBlock.kind === "tool") {
    const n = lastBlock.name.toLowerCase()
    if (n.includes("search") || n.includes("glob") || n.includes("find") || n.includes("fetch")) {
      return "searching"
    }
    if (n.includes("memory") || n.includes("recall")) {
      return "recalling"
    }
    return "working"
  }
  if (lastBlock.kind === "text") return "replying"
  return "working"
}

// ---------- General blocks (Text / Thinking / Panel / Note) ----------
function BlockView({
  b,
  streaming,
}: {
  b: TurnBlock | { kind: "note"; text: string; variant: string }
  streaming?: boolean
}): ReactElement | null {
  if (b.kind === "text") return <Markdown text={b.text} streaming={streaming} />
  if (b.kind === "thinking") return <ThinkingTrace text={b.text} live={streaming} />
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

function ToolBlockView({
  b,
  pending,
  diff,
}: {
  b: Omit<ToolBlock, "summary">
  pending?: boolean
  diff?: { added: number; removed: number }
}): ReactElement {
  const input = (b.input ?? {}) as Record<string, unknown>
  return (
    <ToolTrace
      name={b.name}
      summary={toolSummary(b.name, input)}
      output={b.output}
      isError={b.isError}
      pending={pending}
      diff={diff}
    />
  )
}

// ---------- User Turn View (ZCode remote v4 style elevated card) ----------
function UserTurnView({
  turn,
  onEdit,
  onRewind,
}: {
  turn: UserTurn
  onEdit?: () => void
  onRewind?: () => void
}): ReactElement {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  // Inline rewind confirmation — window.confirm is suppressed in embedded
  // webviews, which made the rewind button look dead. Clicking the undo icon
  // swaps the action row into an explicit 确认/取消 strip instead.
  const [confirmingRewind, setConfirmingRewind] = useState(false)

  const copyText = (): void => {
    if (!turn.text) return
    void navigator.clipboard.writeText(turn.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // Runtime-promoted child report — the payload is FOR THE AGENT (it feeds
  // the parent's next turn), not for the human. Collapse to a one-line jump
  // into the child session instead of rendering the full report.
  if (turn.child) {
    const label =
      turn.child.kind === "result"
        ? "子代理结果"
        : turn.child.kind === "interrupted"
        ? "子代理中断"
        : "子代理失败"
    return (
      <div className="fade-up my-2 flex w-full">
        <button
          type="button"
          className="group -mx-1.5 inline-flex h-7 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover cursor-pointer"
          title="打开子代理会话"
          onClick={() => navigate(`/s/${turn.child!.id}`)}
        >
          <GitBranch size={14} className="flex-none text-faint" />
          <span className="flex-none text-[14px] font-medium text-dim transition-colors group-hover:text-fg">
            {label}
          </span>
          <span className="font-mono text-xs text-ghost transition-colors group-hover:text-faint">
            {turn.child.id.slice(0, 8)}
          </span>
          <ChevronRight size={13} className="text-ghost transition-colors group-hover:text-faint" />
          <span className="text-xs text-ghost transition-colors group-hover:text-dim">查看子会话</span>
        </button>
      </div>
    )
  }

  return (
    <div className="fade-up my-4 flex w-full flex-col items-end">
      <div className="w-fit max-w-full rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong sm:max-w-[75%]">
        {turn.text ? (
          <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-ink [overflow-wrap:anywhere] select-text">
            {turn.text}
          </div>
        ) : null}

        {turn.images && turn.images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {turn.images.map((img, i) => (
              <img
                key={i}
                src={imageUrl(img)}
                alt=""
                className="max-h-48 max-w-full rounded-xl border border-line object-contain shadow-hairline"
              />
            ))}
          </div>
        )}
      </div>

      {/* Action icons below card on the right (ZCode style); the rewind icon
          swaps this row into an inline confirm strip (webviews suppress
          window.confirm, which made the button look dead). */}
      {confirmingRewind ? (
        <div className="flex items-center gap-1.5 mt-1 mr-1 rounded-md border border-bad/30 bg-bad/10 px-2 py-0.5 text-2xs select-none">
          <span className="text-bad">回退将删除本条及其后所有内容</span>
          <button
            type="button"
            className="rounded bg-bad px-2 py-0.5 font-medium text-white transition-colors hover:bg-bad/90"
            onClick={() => {
              setConfirmingRewind(false)
              onRewind?.()
            }}
          >
            回退
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-dim transition-colors hover:bg-hover hover:text-fg"
            onClick={() => setConfirmingRewind(false)}
          >
            取消
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1 mr-1 text-ghost text-xs">
          <button
            type="button"
            onClick={copyText}
            className="hover:text-dim transition-colors p-1"
            title="复制提问"
          >
            <Copy size={13} className={copied ? "text-green" : ""} />
          </button>
          {onEdit && !turn.child && (
            <button
              type="button"
              onClick={onEdit}
              className="hover:text-dim transition-colors p-1"
              title="编辑提问（填回输入框）"
            >
              <Pencil size={13} />
            </button>
          )}
          {onRewind && !turn.child && (
            <button
              type="button"
              onClick={() => setConfirmingRewind(true)}
              className="hover:text-dim transition-colors p-1"
              title="回退到这一步（删除本条及之后）"
            >
              <Undo2 size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** ZCode status-bar clock: 48 秒 / 2 分 43 秒 / 1 小时 2 分 */
// ---------- Assistant Turn View (History Stage) ----------
function AssistantTurnView({
  turn,
  onRetry,
}: {
  turn: UserTurn
  onRetry?: () => void
}): ReactElement | null {
  // Settled turns collapse the execution (thinking + tools) into the status
  // bar; prose stays visible either way. (ZCode 已工作 X 分 X 秒 > semantics)
  const [stepsOpen, setStepsOpen] = useState(false)

  const hasContent = turn.blocks.length > 0 || turn.panels.length > 0 || turn.changes.length > 0
  if (!hasContent) return null

  const grouped = compactSingletonGroups(groupBlocks(turn.blocks))
  const hasSteps = grouped.some((g) => g.kind === "context-group" || g.b.kind === "tool" || g.b.kind === "thinking")
  const fullText = turn.blocks
    .filter((b): b is { kind: "text"; text: string; ts?: number } => b.kind === "text")
    .map((b) => b.text)
    .join("\n\n")

  // Per-path diffstats for ZCode-style edit rows (+A -D next to the file).
  const diffByPath = new Map(turn.changes.map((c) => [c.path, c]))
  const diffOf = (b: TurnBlock): { added: number; removed: number } | undefined => {
    if (b.kind !== "tool") return undefined
    const inp = (b.input ?? {}) as Record<string, unknown>
    return diffByPath.get(String(inp.path ?? inp.file_path ?? ""))
  }

  // Footer timestamp: the last timestamped block (honest history time), not
  // the render time.
  const lastTs = [...turn.blocks].reverse().find((b) => typeof (b as { ts?: number }).ts === "number") as
    | { ts: number }
    | undefined
  const timeStr = lastTs
    ? new Date(lastTs.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : undefined

  // Settle feedback (ZCode/Claude-Code-style end-of-turn summary): duration and
  // token counts aggregated from this turn's model calls.
  const stats = turn.modelCalls.length
    ? {
        ms: turn.modelCalls.reduce((n, c) => n + (c.durationMs ?? 0), 0),
        tokIn: turn.modelCalls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
        tokOut: turn.modelCalls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
      }
    : undefined

  // Status-bar duration: WALL CLOCK (prompt admitted → last event), matching
  // the running turn's timer. stats.ms (model-call time only) is a fallback —
  // using it there made the number visibly shrink at settle.
  const firstTs = turn.ts ?? (turn.blocks.find((b) => typeof (b as { ts?: number }).ts === "number") as { ts?: number } | undefined)?.ts
  const wallMs = firstTs && lastTs ? lastTs.ts - firstTs : 0
  const workedMs = wallMs > 0 ? wallMs : (stats?.ms ?? 0)
  const workedLabel = workedMs > 0 ? "已工作 " + fmtClock(workedMs) : "已工作"

  return (
    <div className="fade-up my-4 flex flex-col gap-2">
      {/* ZCode status bar: the turn's execution collapses into one line —
          已工作 X 分 X 秒 > — prose reads clean, steps expand on demand */}
      {hasSteps && (
        <button
          type="button"
          aria-expanded={stepsOpen}
          title={stepsOpen ? "收起执行步骤" : "展开执行步骤"}
          onClick={() => setStepsOpen((v) => !v)}
          className="group -mx-1.5 inline-flex h-7 w-fit items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium text-faint transition-colors hover:bg-hover hover:text-dim active:bg-hover cursor-pointer select-none"
        >
          <span>{workedLabel}</span>
          <ChevronRight
            size={12}
            className={`transition-transform duration-200 text-faint group-hover:text-dim ${stepsOpen ? "rotate-90" : ""}`}
          />
        </button>
      )}

      {/* Chronological flow: prose always visible; thinking/tools follow the
          status bar's open state */}
      <div className="flex flex-col gap-2 text-[14px] leading-[1.75] text-ink">
        {grouped.map((g, i) => {
          if (g.kind === "context-group") {
            if (!stepsOpen) return null
            return <ContextToolGroup key={`cg-${i}`} tools={g.tools} />
          }
          const b = g.b
          if (b.kind === "tool") {
            if (!stepsOpen) return null
            return <ToolBlockView key={`tb-${i}`} b={b} diff={diffOf(b)} />
          }
          if (b.kind === "thinking") {
            if (!stepsOpen) return null
            return <BlockView key={`bv-${i}`} b={b} />
          }
          return <BlockView key={`bv-${i}`} b={b} />
        })}
      </div>

      <ChangeList changes={turn.changes ?? []} />

      {/* ZCode style action bar */}
      <TurnFooter textToCopy={fullText} timestamp={timeStr} onRetry={onRetry} stats={stats} />
    </div>
  )
}

// ---------- Live Streaming Turn View (Runtime Stream Stage) ----------
function LiveTurnView({ turn }: { turn: LiveTurn }): ReactElement {
  const lastText = [...turn.blocks].reverse().find((b) => b.kind === "text")
  const currentMood = inferLiveMood(turn)
  const grouped = compactSingletonGroups(groupLiveBlocks(turn.blocks))

  // While the turn runs the steps stream live (status bar expanded); when it
  // settles the steps fold back into the 已工作 status line.
  const [stepsOpen, setStepsOpen] = useState(turn.busy)
  const [liveSec, setLiveSec] = useState(0)
  useEffect(() => {
    if (turn.busy) {
      setStepsOpen(true)
      setLiveSec(Math.floor((Date.now() - turn.startedAt) / 1000))
      const t = setInterval(() => setLiveSec(Math.floor((Date.now() - turn.startedAt) / 1000)), 1000)
      return () => clearInterval(t)
    }
    setStepsOpen(false)
  }, [turn.busy, turn.startedAt])
  const hasSteps = grouped.some((g) => g.kind === "context-group" || g.b.kind === "tool" || g.b.kind === "thinking")

  return (
    <div className="fade-up my-4 flex flex-col gap-2">
      {/* 1. Immediate User Prompt Card (ZCode style) */}
      {turn.userPrompt && (
        <div className="my-2 flex w-full flex-col items-end">
          <div className="w-fit max-w-full rounded-lg border border-line bg-surface p-3 sm:max-w-[75%]">
            <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-ink [overflow-wrap:anywhere] select-text">
              {turn.userPrompt}
            </div>
            {turn.images && turn.images.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {turn.images.map((img, i) => (
                  <img
                    key={i}
                    src={imageUrl(img)}
                    alt=""
                    className="max-h-48 max-w-full rounded-xl border border-line object-contain shadow-hairline"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. ZCode status bar: 工作中 X 分 X 秒 > — steps stream below while
          running and fold back into the line when the turn settles */}
      {hasSteps ? (
        <button
          type="button"
          aria-expanded={stepsOpen}
          title={stepsOpen ? "收起执行步骤" : "展开执行步骤"}
          onClick={() => setStepsOpen((v) => !v)}
          className="group -mx-1.5 my-0.5 inline-flex h-7 w-fit items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-faint transition-colors hover:bg-hover hover:text-dim active:bg-hover cursor-pointer select-none"
        >
          <EmotionBall mood={currentMood} size={16} lite hasRing={false} />
          {!turn.busy && turn.error ? (
            <span className="text-bad">已中断</span>
          ) : (
            <span>
              {turn.busy ? "工作中" : "已工作"}
              {liveSec > 0 ? " " + fmtClock(liveSec * 1000) : ""}
            </span>
          )}
          {!turn.busy && turn.error && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="flex-none text-bad">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          )}
          {turn.busy && <PixelLoader label="" showTimer={false} />}
          <ChevronRight
            size={12}
            className={`flex-none transition-transform duration-200 text-faint group-hover:text-dim ${stepsOpen ? "rotate-90" : ""}`}
          />
        </button>
      ) : (
        <div className="group -mx-1.5 my-0.5 inline-flex h-7 w-fit items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-faint select-none">
          <EmotionBall mood={currentMood} size={16} lite hasRing={false} />
          {turn.busy && (
            <PixelLoader
              label={
                currentMood === "searching"
                  ? "正在检索资料"
                  : currentMood === "thinking"
                  ? "正在推导演化"
                  : currentMood === "working"
                  ? "正在执行操作"
                  : "工作中"
              }
            />
          )}
        </div>
      )}

      {/* 3. Chronological flow: reasoning / tools / prose in event order */}
      <div className="flex flex-col gap-2 text-[14px] leading-[1.75] text-ink">
        {grouped.map((g, i) => {
          if (g.kind === "context-group") {
            if (!stepsOpen) return null
            const isGroupPending = g.tools.some((t) => t.output === undefined)
            return <ContextToolGroup key={`lcg-${i}`} tools={g.tools} pending={isGroupPending} />
          }
          const b = g.b
          if (b.kind === "tool") {
            if (!stepsOpen) return null
            return (
              <ToolBlockView
                key={`ltb-${i}`}
                b={{ kind: "tool", callId: b.callId, name: b.name, input: b.input, output: b.output, isError: b.isError }}
                pending={b.streaming === true || b.output === undefined}
              />
            )
          }
          if (b.kind === "thinking") {
            if (!stepsOpen) return null
            return <BlockView key={`lbv-${i}`} b={b} streaming={true} />
          }
          if (b.kind === "text") {
            return <BlockView key={`ltext-${i}`} b={b} streaming={g.b === lastText || undefined} />
          }
          if (b.kind === "note") {
            return <BlockView key={`lnote-${i}`} b={b} />
          }
          return null
        })}
      </div>

      {turn.panels.map((p) => (
        <PanelCard key={p.panelId} panel={p} />
      ))}

      <ChangeList changes={turn.changes ?? []} />
    </div>
  )
}

// ---------- Main Transcript Component ----------
export function Transcript({
  sessionId,
  onOpenMobileNav,
  onNewTask,
  mobileNavOpen = false,
}: {
  mobileNavOpen?: boolean
  sessionId: string
  onOpenMobileNav?: () => void
  onNewTask?: () => void
}): ReactElement {
  const { sessions, workspace } = useApp()
  const { live, dismiss, stop } = useStream()

  const [events, setEvents] = useState<StoredEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Workspace Pulse is the single source for live session status; the resource
  // pane stays focused on opening and operating host capabilities.
  const [resourceRequest, setResourceRequest] = useState<{ tab: string }>()
  const [pulseOpen, setPulseOpen] = useState(false)
  const [workbenchOpen, setWorkbenchOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [approvalFocusRequest, setApprovalFocusRequest] = useState(0)
  const openApprovals = useCallback(() => {
    setWorkbenchOpen(false)
    setApprovalFocusRequest((value) => value + 1)
  }, [])
  const drawerMode = useMediaQuery("(max-width: 1279px)")
  const navMode = useMediaQuery("(max-width: 767px)")
  const navDrawerOpen = mobileNavOpen && navMode
  const consumeResourceRequest = useCallback(() => setResourceRequest(undefined), [])
  useEffect(() => {
    if (!navDrawerOpen) return
    setWorkbenchOpen(false)
    setPulseOpen(false)
  }, [navDrawerOpen])
  const loadSeq = useRef(0)

  const load = useCallback(async (): Promise<StoredEventRow[] | null> => {
    const requestId = ++loadSeq.current
    try {
      const rows = await api.events(sessionId)
      if (requestId !== loadSeq.current) return null
      setEvents(rows)
      setError(null)
      return rows
    } catch (err) {
      if (requestId !== loadSeq.current) return null
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      if (requestId === loadSeq.current) setLoading(false)
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
      const rows = await load()
      if (alive && rows && liveTurn) {
        const promptSeq = rows
          .filter((event) => (event.type === "Session.Prompted" || event.type === "Session.PromptAdmitted") && String(event.data?.id ?? "") === liveTurn.promptId)
          .reduce<number | undefined>((max, event) => max === undefined || event.seq > max ? event.seq : max, undefined)
        const settledAfterPrompt = promptSeq !== undefined && rows.some((event) => event.seq > promptSeq && (event.type === "Session.StepEnded" || event.type === "Session.Interrupted"))
        if (settledAfterPrompt) dismiss(sessionId, liveTurn.startedAt)
      }
    })()
    return () => {
      alive = false
    }
  }, [settled, sessionId, load, dismiss, liveTurn])

  const items = useMemo(() => foldTranscript(events ?? []), [events])
  const sessionContext = useSessionContext(sessionId, events)
  const activity = useMemo(() => deriveSessionActivity({ events: events ?? [], items, liveTurn, context: sessionContext.state.data?.context, policy: sessionContext.state.data?.policy }), [events, items, liveTurn, sessionContext.state.data?.context, sessionContext.state.data?.policy])

  const livePromptSeq = useMemo(() => {
    if (!liveTurn) return undefined
    return [...(events ?? [])].reverse().find((event) =>
      (event.type === "Session.PromptAdmitted" || event.type === "Session.Prompted") && String(event.data?.id ?? "") === liveTurn.promptId,
    )?.seq
  }, [events, liveTurn])

  // the folded log — rendering both the folded card and the LiveTurnView card
  // would duplicate the user message (most visible after switching sessions
  // away and back). Drop only the exact durable event that belongs to this live
  // prompt; identical prompt text is not an identity.
  const visibleItems = useMemo(() => {
    if (!liveTurn) return items
    // Primary identity: the durable prompt's id (the runtime uses the client's
    // promptId for PromptAdmitted/Prompted). Fallback: identical user text, so a
    // turn whose id did not survive the round-trip (e.g. a pre-existing log with
    // a bogus/empty id) still does not render twice while streaming.
    let idx = items.findIndex((it) => it.kind === "user" && it.promptId && it.promptId === liveTurn.promptId)
    if (idx === -1 && liveTurn.userPrompt?.trim()) {
      const target = liveTurn.userPrompt.trim()
      idx = items.findIndex((it) => it.kind === "user" && it.text.trim() === target)
    }
    if (idx === -1) return items
    return items.filter((_, i) => i !== idx)
  }, [items, liveTurn])

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

  const wsName = row?.workspace
    ? row.workspace.split(/[/\\]/).filter(Boolean).pop() ?? "newhorse"
    : "newhorse"

  const onSelectPrompt = (promptText: string): void => {
    window.dispatchEvent(new CustomEvent("nh-fill-prompt", { detail: promptText }))
  }

  // A model pick in the sidebar switcher applies to the OPEN session too
  // (Session.ModelSet) — otherwise the choice only affects future sessions and
  // the composer label looks stuck.
  useEffect(() => {
    const onApply = (event: Event): void => {
      const model = (event as CustomEvent<string>).detail
      if (!model) return
      void api.setSessionModel(sessionId, model).then(() => {
        void load()
        window.dispatchEvent(new Event("nh-refresh-sessions"))
      }).catch(() => {})
    }
    window.addEventListener("nh-apply-session-model", onApply)
    return () => window.removeEventListener("nh-apply-session-model", onApply)
  }, [sessionId, load])

  const rewindTo = (seq: number): void => {
    // In-place rewind (Session.Truncated). The destructive-action confirmation
    // happens inline in the turn card (window.confirm is suppressed in some
    // embedded webviews).
    void api
      .truncateSession(sessionId, seq)
      .then(() => {
        void load()
        window.dispatchEvent(new Event("nh-refresh-sessions"))
      })
      .catch((err) => {
        // Surface a non-fatal toast; do not navigate away.
        window.dispatchEvent(new CustomEvent("nh-toast", { detail: err instanceof Error ? err.message : "回退失败" }))
      })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sleek Header Bar — aligned with ZCode remote v4 */}
      <div className="relative flex flex-none items-center justify-between border-b border-line bg-panel px-3 sm:px-6 py-2 sm:py-2.5 pt-safe-top">
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          {/* Hamburger button on mobile */}
          <button
            type="button"
            className="icon-btn !h-9 !w-9 md:hidden text-fg"
            title="展开会话列表"
            onClick={() => { setWorkbenchOpen(false); setPulseOpen(false); onOpenMobileNav?.() }}
          >
            <Menu size={18} />
          </button>

          <span
            className={`dot flex-none ${
              liveTurn?.busy || row?.status === "active"
                ? "dot-active"
                : row?.status === "interrupted"
                ? "dot-error"
                : "dot-settled"
            }`}
          />
          <h1 className="min-w-0 truncate text-xs sm:text-sm font-semibold tracking-tight text-fg">
            {title}
          </h1>

          {/* Workspace capsule */}
          <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-line bg-surface/80 px-2 py-0.5 text-2xs text-dim font-mono select-none">
            <Folder size={11} className="text-dim" />
            <span>{wsName}</span>
          </span>


        </div>

        {/* Right header actions */}
        <div className="flex items-center gap-2">
          {/* Desktop utility buttons (all REAL) */}
          <div className="flex items-center gap-1 text-ghost">
            <button
              type="button"
              aria-label={workbenchOpen ? "收起工作台" : "展开工作台"}
              className={`icon-btn !h-7 !w-7 ${workbenchOpen ? "bg-hover text-dim" : "hover:text-dim"}`}
              title={workbenchOpen ? "收起工作台" : "展开工作台"}
              onClick={() => setWorkbenchOpen((v) => !v)}
            >
              <PanelRight size={14} />
            </button>
          </div>

          {/* Mobile New Task Shortcut */}
          <button
            type="button"
            className="icon-btn !h-9 !w-9 md:hidden text-dim hover:text-fg"
            title="新建任务"
            onClick={onNewTask}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Chat sub-column: stream + dock composer share one centering parent */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The pulse is a status surface; the resource pane below stays operational. */}
          <WorkspacePulse
            activity={activity}
            wsName={wsName}
            workspace={row?.workspace || (sessions.length === 0 ? workspace : undefined)}
            open={pulseOpen}
            onToggle={() => setPulseOpen((value) => !value)}
            onOpenResource={(tab) => {
              setWorkbenchOpen(true)
              setResourceRequest({ tab })
              setPulseOpen(false)
            }}
            onStop={liveTurn?.busy ? () => void stop(sessionId, liveTurn.startedAt) : undefined}
            onFocusComposer={() => {
              window.dispatchEvent(new Event("nh-focus-composer"))
              setPulseOpen(false)
            }}
          />
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
              <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
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

            {empty && (
              <div className="my-auto flex w-full flex-col items-center gap-5 py-12 text-center">
                <EmotionBall mood="listening" size={116} interactive hasRing className="float-gentle" />
                <div><h2 className="text-xl font-semibold tracking-tight text-fg">准备好了</h2><p className="mt-2 text-sm text-faint">描述目标，newhorse 会在当前工作区持续推进。</p></div>
              </div>
            )}

            {/* Chat message stream */}
            {!loading &&
              !error &&
              visibleItems.map((it, i) =>
                it.kind === "user" ? (
                  <div key={`turn-${i}`}>
                    <UserTurnView
                      turn={it}
                      onEdit={() => it.text && onSelectPrompt(it.text)}
                      onRewind={() => rewindTo(it.seq)}
                    />
                    <AssistantTurnView
                      turn={it}
                      onRetry={() => it.text && onSelectPrompt(it.text)}
                    />
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
                type="button"
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

          {/* Dock composer lives INSIDE the chat sub-column so it stays
              center-aligned with the stream column (mobile keeps it pinned) */}
          <div>
            <ApprovalDock hidden={navDrawerOpen || (workbenchOpen && drawerMode)} onPendingCount={setPendingApprovals} focusRequest={approvalFocusRequest} />
            <Composer sessionId={sessionId} variant="dock" />
          </div>
        </div>

        {workbenchOpen && !navDrawerOpen && (
          <WorkbenchPane
            requestedTab={resourceRequest}
            pendingApprovals={pendingApprovals}
            onOpenApprovals={openApprovals}
            onRequestedTabConsumed={consumeResourceRequest}
            sessionId={sessionId}
            wsName={wsName}
            workspace={row?.workspace || (sessions.length === 0 ? workspace : undefined)}
            events={events}
            items={items}
            liveTurn={liveTurn}
            status={row?.status}
            onClose={() => setWorkbenchOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
