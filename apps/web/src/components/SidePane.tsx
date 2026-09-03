/**
 * Right sidePane — five tabs (ZCode sidePane density), collapsible, carrying
 * the wide-layout requirement (§1.8):
 *  1. 子代理树  — parentId indentation, seven display states (#16), per-node
 *     model (cost-down visibility, §1.5④), followup entry.
 *  2. 文件树    — lazy tree (shallow-then-deep) + file viewer (utf8 mono /
 *     image preview / 2MB truncation banner / "仅显示变更文件" filter, #36).
 *  3. 上下文   — context stats grid + goal (opencode Context page).
 *  4. 文件活动  — per-turn activity tree folded from events (Live/快照 badge;
 *     create/modify/delete/view four kinds, #39 treemapping).
 *  5. 审批     — pending approvals + settled history.
 */
import { useNavigate } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  Check,
  ChevronRight,
  CircleDashed,
  File as FileIcon,
  FileCode2,
  Folder,
  FolderOpen,
  Hourglass,
  ImageIcon,
  ListTree,
  Lock,
  MessageSquarePlus,
  Network,
  PanelRightClose,
  ShieldQuestion,
  X,
} from "lucide-react"
import { api } from "../api/client"
import { useBusRefresh } from "../api/bus"
import type { ApprovalRequest, ContextView, FsEntry, GoalView, SessionRow, StoredEventRow } from "../api/types"
import { deriveSubagents, foldTranscript, relativeTime, type SubagentState } from "../api/fold"
import { useApi } from "../lib/useApi"
import { EmptyState, LoadingState, ProgressBar, Spinner, Toggle } from "./ui"

type Tab = "subagents" | "files" | "context" | "activity" | "approvals"

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "subagents", label: "子代理", icon: <Network size={13} /> },
  { id: "files", label: "文件", icon: <Folder size={13} /> },
  { id: "context", label: "上下文", icon: <Activity size={13} /> },
  { id: "activity", label: "活动", icon: <ListTree size={13} /> },
  { id: "approvals", label: "审批", icon: <ShieldQuestion size={13} /> },
]

export function SidePane({
  sessionId,
  workspace,
  events,
  contextView,
  goal,
  onClose,
  width,
  onResize,
}: {
  sessionId: string
  workspace: string
  events: StoredEventRow[]
  contextView: ContextView | null
  goal: GoalView | null
  onClose: () => void
  width?: number
  onResize?: (w: number) => void
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>("subagents")

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width ?? 340
    // Clamp against the viewport, not a fixed number: small windows cap at
    // 70vw, large ones allow the pane to grow well past 560px.
    const maxW = Math.max(340, Math.floor(window.innerWidth * 0.7))
    const move = (ev: PointerEvent) => {
      const next = Math.min(maxW, Math.max(240, startW + (startX - ev.clientX)))
      onResize?.(next)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <aside
      data-pane
      className="fixed inset-x-0 bottom-0 z-40 flex h-[74vh] w-full flex-col rounded-t-2xl border-t border-line bg-panel shadow-overlay md:relative md:z-auto md:h-full md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none"
      style={{ ["--pane-w" as string]: `${width ?? 340}px` }}
    >
      {/* desktop drag handle on the left edge */}
      <div
        onPointerDown={startDrag}
        className="absolute -left-1 top-0 z-50 hidden h-full w-2 cursor-col-resize md:block"
        title="拖拽调整宽度"
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors hover:bg-accent" />
      </div>
      <div className="flex items-center justify-center md:hidden" aria-hidden>
        <span className="mt-2 h-1 w-10 rounded-full bg-linestrong" />
      </div>
      <div className="flex items-center gap-1 border-b border-line px-2 py-2 md:py-1.5">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.label}
              className="flex flex-none items-center gap-1.5 rounded-md px-2 py-1.5 text-2xs transition-colors"
              style={tab === t.id ? { background: "var(--hover-2)", color: "var(--txt)" } : { color: "var(--txt-faint)" }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <button className="icon-btn !h-7 !w-7" onClick={onClose} title="收起面板">
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "subagents" && <SubagentsTab sessionId={sessionId} />}
        {tab === "files" && <FilesTab workspace={workspace} events={events} />}
        {tab === "context" && <ContextTab contextView={contextView} goal={goal} />}
        {tab === "activity" && <ActivityTab events={events} />}
        {tab === "approvals" && <ApprovalsTab />}
      </div>
    </aside>
  )
}

// --- 1. subagents ---

const SUB_STATE: Record<SubagentState, { label: string; color: string; icon: React.ReactNode }> = {
  running: { label: "运行中", color: "var(--warn)", icon: <Spinner size={11} /> },
  waiting: { label: "等待", color: "var(--txt-faint)", icon: <Hourglass size={11} /> },
  blocked: { label: "待审批", color: "var(--warn)", icon: <ShieldQuestion size={11} /> },
  success: { label: "已完成", color: "var(--ok)", icon: <Check size={11} /> },
  failed: { label: "失败", color: "var(--bad)", icon: <X size={11} /> },
  cancelled: { label: "已取消", color: "var(--txt-ghost)", icon: <CircleDashed size={11} /> },
  lost: { label: "已丢失", color: "var(--txt-ghost)", icon: <CircleDashed size={11} /> },
}

function SubagentsTab({ sessionId }: { sessionId: string }): React.ReactElement {
  const navigate = useNavigate()
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [])
  const live = useApi(() => api.live(), [])
  const [followUp, setFollowUp] = useState<string | null>(null)
  const [followText, setFollowText] = useState("")
  // Settle frames (any session) change child states + liveness — refresh.
  useBusRefresh((f) => f.event.type === "result" || f.event.type === "done" || f.event.type === "error", () => {
    sessions.retry()
    live.retry()
  }, 2_000)
  const subs = useMemo(() => {
    if (!sessions.data) return []
    const liveIds = new Set((live.data?.live ?? []).map((l) => l.sessionId))
    return deriveSubagents(sessions.data, { parentId: sessionId, liveSessionIds: liveIds })
  }, [sessions.data, live.data, sessionId])

  if (sessions.loading) return <LoadingState />
  return (
    <div className="p-2">
      {followUp && (
        <div className="mb-2 flex gap-1.5">
          <input
            autoFocus
            className="input !py-1.5 flex-1 text-xs"
            placeholder={`追问 ${followUp.slice(0, 8)}…`}
            value={followText}
            onChange={(e) => setFollowText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && followText.trim()) {
                void api.steer(followUp, followText)
                setFollowUp(null)
                setFollowText("")
              }
              if (e.key === "Escape") setFollowUp(null)
            }}
            onBlur={() => setFollowUp(null)}
          />
        </div>
      )}
      {subs.length === 0 ? (
        <EmptyState icon={<Network size={18} />} title="暂无子代理" hint="主会话在回合边界用 spawn_agent / declare_dag 派生子代理后，会出现在这里。" />
      ) : (
        subs.map((s) => {
          const st = SUB_STATE[s.state]
          return (
            <div key={s.session.sessionId} className="mb-1.5 rounded-lg border border-line bg-bg2 p-2.5" style={{ marginLeft: (s.depth - 1) * 14 }}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex-none" style={{ color: st.color }}>
                  {st.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-fg">{s.session.title ?? s.session.sessionId}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-faint">
                    <span style={{ color: st.color }}>{st.label}</span>
                    {s.session.model && (
                      <>
                        <span>·</span>
                        <span className="truncate font-mono">{s.session.model}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{relativeTime(s.session.updatedAt)}</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex gap-1.5">
                <button
                  className="btn !py-1 text-2xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFollowUp(s.session.sessionId)
                    setFollowText("")
                  }}
                >
                  <MessageSquarePlus size={11} /> 追问
                </button>
                <button
                  className="btn !py-1 text-2xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/session/${s.session.sessionId}`)
                  }}
                >
                  <ListTree size={11} /> 转录
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// --- 2. files tree + viewer ---

function FilesTab({ workspace, events }: { workspace: string; events: StoredEventRow[] }): React.ReactElement {
  const [changedOnly, setChangedOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  // 通用懒加载（ZCode get_dir_structure 先浅后深语义）：按需拉取子目录，
  // 缓存在 Map 里——根目录挂载时拉一次，其余在展开时拉。
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({})
  const root = useApi<{ path: string; entries: FsEntry[] }>(() => api.fs(workspace, "."), [workspace])
  const file = useApi(() => (selected ? api.file(workspace, selected) : null), [selected, workspace])

  const fetchDir = (dir: string): void => {
    void api.fs(workspace, dir).then((r) => setChildren((prev) => ({ ...prev, [dir]: r.entries }))).catch(() => {})
  }
  const toggle = (name: string, dir: boolean): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else {
        next.add(name)
        if (dir && !children[name]) fetchDir(name)
      }
      return next
    })
  }

  const changedPaths = useMemo(() => {
    const set = new Set<string>()
    for (const it of foldTranscript(events)) if (it.kind === "user") for (const c of it.changes) set.add(c.path)
    return set
  }, [events])


  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-mono text-2xs text-faint">workspace/</span>
        <label className="flex items-center gap-1.5 text-2xs text-dim">
          <Toggle checked={changedOnly} onChange={setChangedOnly} />
          仅变更文件
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {root.loading ? (
          <LoadingState />
        ) : (
          <TreeLevel
            entries={root.data?.entries ?? []}
            parentPath=""
            depth={0}
            expanded={expanded}
            childMap={children}
            changedPaths={changedPaths}
            changedOnly={changedOnly}
            onToggle={toggle}
            onSelect={setSelected}
          />
        )}
      </div>      {selected && (
        <div className="flex h-[46%] flex-none flex-col border-t border-line">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-2xs text-dim">
              <FileCode2 size={11} className="flex-none" />
              <span className="truncate">{selected}</span>
            </span>
            <button className="icon-btn !h-6 !w-6" onClick={() => setSelected(null)}>
              <X size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-bg2 px-3 py-2">
            {file.loading ? (
              <LoadingState className="!py-8" />
            ) : file.data?.truncated ? (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-2xs text-warn">
                <Hourglass size={11} /> 文件超过 2MB，仅显示前部分内容。
              </div>
            ) : null}
            {/\.(png|jpe?g|gif|webp|svg)$/i.test(selected) && file.data?.encoding === "base64" ? (
              <div className="flex h-full items-center justify-center p-2">
                <img
                  src={`data:image/${selected.split(".").pop()};base64,${file.data.content}`}
                  alt={selected}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <pre className="font-mono text-2xs leading-relaxed text-dim">{file.data?.content ?? ""}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TreeRow({ name, dir, depth, open, changed, onToggle }: { name: string; dir: boolean; depth: number; open: boolean; changed: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-2xs hover:bg-hover"
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {dir ? (
        open ? <FolderOpen size={12} className="flex-none text-dim" /> : <Folder size={12} className="flex-none text-dim" />
      ) : (
        <FileIcon size={12} className="flex-none text-faint" />
      )}
      <span className={`flex-1 truncate font-mono ${changed ? "text-trajtool" : "text-dim"}`}>{name}</span>
      {changed && <span className="h-1.5 w-1.5 flex-none rounded-full bg-trajtool" />}
    </button>
  )
}

/** Recursive tree level: renders entries and lazily-fetched children. */
function TreeLevel({
  entries,
  parentPath,
  depth,
  expanded,
  childMap,
  changedPaths,
  changedOnly,
  onToggle,
  onSelect,
}: {
  entries: FsEntry[]
  parentPath: string
  depth: number
  expanded: Set<string>
  childMap: Record<string, FsEntry[]>
  changedPaths: Set<string>
  changedOnly: boolean
  onToggle: (name: string, dir: boolean) => void
  onSelect: (path: string) => void
}): React.ReactElement {
  const visible = entries.filter((e) => {
    const path = parentPath ? `${parentPath}/${e.name}` : e.name
    return !changedOnly || e.dir || changedPaths.has(path)
  })
  return (
    <>
      {visible.map((e) => {
        const path = parentPath ? `${parentPath}/${e.name}` : e.name
        const isOpen = expanded.has(path)
        const kids = childMap[path]
        return (
          <div key={path}>
            <TreeRow
              name={e.name}
              dir={e.dir}
              depth={depth}
              open={isOpen}
              changed={changedPaths.has(path)}
              onToggle={() => (e.dir ? onToggle(path, true) : onSelect(path))}
            />
            {e.dir && isOpen && (
              <>
                {kids ? (
                  kids.length > 0 ? (
                    <TreeLevel entries={kids} parentPath={path} depth={depth + 1} expanded={expanded} childMap={childMap} changedPaths={changedPaths} changedOnly={changedOnly} onToggle={onToggle} onSelect={onSelect} />
                  ) : (
                    <div className="py-1 text-2xs text-ghost" style={{ paddingLeft: 20 + depth * 14 }}>空目录</div>
                  )
                ) : (
                  <div className="py-1 text-center text-2xs text-faint"><Spinner size={11} /></div>
                )}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

// --- 3. context ---

function ContextTab({ contextView, goal }: { contextView: ContextView | null; goal: GoalView | null }): React.ReactElement {
  if (!contextView) return <LoadingState />
  const ratio = contextView.ratio ?? (contextView.windowTokens ? contextView.estTokens / contextView.windowTokens : 0)
  return (
    <div className="p-3">
      <div className="label mb-2">上下文占用</div>
      <div className="card mb-3 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold text-fg">{(ratio * 100).toFixed(1)}%</span>
          <span className="font-mono text-2xs text-faint">
            {contextView.estTokens.toLocaleString()} / {contextView.windowTokens ? contextView.windowTokens.toLocaleString() : "—"} tokens
          </span>
        </div>
        <ProgressBar ratio={ratio} tone={ratio > 0.85 ? "bad" : ratio > 0.6 ? "warn" : "accent"} className="mt-2" />
        <div className="mt-2 grid grid-cols-2 gap-2 text-2xs">
          <Stat label="字符数" value={contextView.chars.toLocaleString()} />
          <Stat label="估算 tokens" value={contextView.estTokens.toLocaleString()} />
        </div>
      </div>

      <div className="label mb-2">目标预算</div>
      <div className="card p-3">
        {goal ? (
          <>
            <div className="text-xs font-medium text-fg">{goal.objective}</div>
            <div className="mt-1 flex items-center justify-between font-mono text-2xs text-faint">
              <span>{goal.status}</span>
              {goal.tokenBudget && <span>{Math.round((goal.tokensUsed ?? 0) / 1000)}k / {Math.round(goal.tokenBudget / 1000)}k</span>}
            </div>
            {goal.tokenBudget && <ProgressBar ratio={(goal.tokensUsed ?? 0) / goal.tokenBudget} className="mt-2" />}
          </>
        ) : (
          <EmptyState className="!py-6" icon={<Lock size={16} />} title="未设定目标" hint="用 /goal 或接口设定 objective 与 token 预算。" />
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-bg2 px-2 py-1.5">
      <div className="text-ghost">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-fg">{value}</div>
    </div>
  )
}

// --- 4. per-turn file activity ---

function ActivityTab({ events }: { events: StoredEventRow[] }): React.ReactElement {
  const turns = useMemo(() => foldTranscript(events).filter((t): t is Extract<typeof t, { kind: "user" }> => t.kind === "user"), [events])
  const currentIdx = turns.length - 1
  return (
    <div className="p-2">
      {turns.length === 0 ? (
        <EmptyState icon={<ListTree size={18} />} title="本轮还没有文件活动" hint="read/write/edit/glob/grep 触及的文件会按轮次折叠成树。" />
      ) : (
        turns
          .map((turn, i) => ({ turn, i }))
          .reverse()
          .map(({ turn, i }) => (
            <div key={turn.seq} className="mb-2">
              <div className="flex items-center gap-2 px-1.5 py-1">
                <span className="text-2xs font-medium text-dim">第 {i + 1} 轮</span>
                <span className="chip !py-0 !text-[10px]" style={i === currentIdx ? undefined : { opacity: 0.6 }}>
                  {i === currentIdx ? "Live" : "快照"}
                </span>
                <span className="ml-auto font-mono text-2xs text-ghost">{relativeTime(turn.ts ?? 0)}</span>
              </div>
              {turn.activity.length === 0 ? (
                <div className="px-2 py-1 text-2xs text-ghost">无文件操作</div>
              ) : (
                turn.activity.map((a, j) => (
                  <div key={j} className="flex items-center gap-2 rounded-md px-2 py-1 text-2xs hover:bg-hover">
                    <KindMark kind={a.kind} />
                    <span className="flex-1 truncate font-mono text-dim">{a.path}</span>
                    <span className="font-mono text-ghost">{a.tool}</span>
                  </div>
                ))
              )}
            </div>
          ))
      )}
    </div>
  )
}

function KindMark({ kind }: { kind: string }): React.ReactElement {
  const map: Record<string, { label: string; color: string }> = {
    create: { label: "写入", color: "var(--traj-user)" },
    modify: { label: "修改", color: "var(--traj-tool)" },
    delete: { label: "删除", color: "var(--bad)" },
    view: { label: "查看", color: "var(--txt-ghost)" },
  }
  const m = map[kind] ?? map.view
  return (
    <span className="flex-none rounded px-1 py-0.5 text-[10px]" style={{ color: m.color, border: `1px solid ${m.color}55` }}>
      {m.label}
    </span>
  )
}

// --- 5. approvals ---

function ApprovalsTab(): React.ReactElement {
  const approvals = useApi<{ approvals: ApprovalRequest[] }>(() => api.approvals(), [])
  const [settled, setSettled] = useState<Array<{ req: ApprovalRequest; allow: boolean }>>([])
  const [error, setError] = useState<string | null>(null)
  // Approvals appear mid-turn and auto-deny after 120s engine-side — poll and
  // refresh on tool frames (a starting tool under strict policy raises one).
  useEffect(() => {
    const t = setInterval(() => approvals.retry(), 3_000)
    return () => clearInterval(t)
  }, [])
  useBusRefresh((f) => f.event.type === "tool", approvals.retry, 2_000)
  const decide = (req: ApprovalRequest, allow: boolean, reply?: string): void => {
    void api
      .approve(req.id, allow, reply)
      .then(() => {
        setSettled((p) => [{ req, allow }, ...p])
        setError(null)
        approvals.retry()
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  if (approvals.loading) return <LoadingState />
  const pending = approvals.data?.approvals ?? []
  return (
    <div className="p-2">
      {error && <div className="mb-2 px-1.5 text-2xs text-bad">{error}</div>}
      {pending.length === 0 && settled.length === 0 ? (
        <EmptyState icon={<ShieldQuestion size={18} />} title="没有待审批项" hint="strict 策略下，命令执行与敏感路径写入会在这里请求确认；模型提问（ask_user）也会出现在这里。" />
      ) : (
        <>
          {pending.map((req) =>
            req.kind === "question" ? (
              <div key={req.id} className="mb-2 rounded-lg border border-line bg-bg2 p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-warn">
                  <ShieldQuestion size={12} /> 模型提问
                </div>
                <p className="rounded-md bg-panel p-2 text-xs leading-relaxed text-fg">{req.target}</p>
                {req.options && req.options.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {req.options.map((opt) => (
                      <button key={opt} className="btn btn-primary !py-1 text-2xs" onClick={() => decide(req, true, opt)}>
                        {opt}
                      </button>
                    ))}
                    <button className="btn btn-danger !py-1 text-2xs" onClick={() => decide(req, false)}>
                      <X size={11} /> 拒绝
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    <button className="btn btn-primary !py-1 text-2xs" onClick={() => decide(req, true)}>
                      <Check size={11} /> 同意
                    </button>
                    <button className="btn btn-danger !py-1 text-2xs" onClick={() => decide(req, false)}>
                      <X size={11} /> 拒绝
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div key={req.id} className="mb-2 rounded-lg border border-line bg-bg2 p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-warn">
                  <ShieldQuestion size={12} /> {req.kind === "command" ? "命令执行" : req.kind === "path" ? "文件写入" : "模式切换"}
                </div>
                <code className="block break-all rounded-md bg-panel p-2 font-mono text-2xs text-fg">{req.target}</code>
                {req.reason && <p className="mt-1.5 text-2xs leading-relaxed text-faint">{req.reason}</p>}
                <div className="mt-2 flex gap-1.5">
                  <button className="btn btn-primary !py-1 text-2xs" onClick={() => decide(req, true)}>
                    <Check size={11} /> 允许
                  </button>
                  <button className="btn btn-danger !py-1 text-2xs" onClick={() => decide(req, false)}>
                    <X size={11} /> 拒绝
                  </button>
                </div>
              </div>
            ),
          )}
          {settled.length > 0 && (
            <>
              <div className="label px-1.5 py-1">已处理</div>
              {settled.map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-2xs text-faint">
                  {s.allow ? <Check size={11} className="text-ok" /> : <X size={11} className="text-bad" />}
                  <span className="flex-1 truncate font-mono">{s.req.target}</span>
                  <span>{s.allow ? "已允许" : "已拒绝"}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

void ChevronRight
