import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement } from "react"
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleOff,
  Clipboard,
  Code2,
  Database,
  ExternalLink,
  FileCode2,
  FileDiff,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe2,
  History,
  Loader2,
  PanelRightClose,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  TerminalSquare,
  X,
} from "lucide-react"
import { api } from "../api/client"
import { foldPanels, langOf, type ToolBlock } from "../api/fold"
import type { FileContent, FsEntry, StoredEventRow } from "../api/types"
import type { LiveTurn } from "../state/store"
import { ChangeList } from "./ChangeList"
import { ErrorState, Spinner } from "./ui"
import { PanelCard } from "./PanelCard"
import { deriveSessionActivity } from "../workbench/activity"
import { useFilePreview, useDirectory, useSessionContext } from "../workbench/hooks"
import { useWorkbenchProviders } from "../workbench/registry"
import { PANE_DEFAULT, PANE_MAX, PANE_MIN, readPaneWidth, readTab, sessionKey, write } from "../workbench/storage"
import { terminalController } from "../workbench/terminal-controller"
import type { BuiltinWorkbenchTab, WorkbenchProvider, WorkbenchTab } from "../workbench/types"
import { createFileNavigation, reduceFileNavigation } from "../workbench/file-navigation"

const BUILTIN_TABS: BuiltinWorkbenchTab[] = ["agents", "terminal", "files", "activity", "preview", "context"]

function tabLabel(tab: WorkbenchTab): string {
  if (tab === "agents") return "子智能体"
  if (tab === "terminal") return "终端"
  if (tab === "files") return "文件"
  if (tab === "activity") return "文件活动"
  if (tab === "preview") return "产物"
  if (tab === "context") return "上下文"
  return tab
}

function tabIcon(tab: WorkbenchTab, size = 13): ReactElement {
  if (tab === "agents") return <GitBranch size={size} />
  if (tab === "terminal") return <TerminalSquare size={size} />
  if (tab === "files") return <FolderOpen size={size} />
  if (tab === "activity") return <FileDiff size={size} />
  if (tab === "preview") return <FileText size={size} />
  if (tab === "context") return <Gauge size={size} />
  return <Globe2 size={size} />
}

function sourceLabel(source: WorkbenchProvider["resource"]["source"]): string {
  if (source === "mcp") return "MCP"
  if (source === "plugin") return "插件"
  return "内置"
}

function sourceClass(source: WorkbenchProvider["resource"]["source"]): string {
  if (source === "mcp") return "workbench-source is-mcp"
  if (source === "plugin") return "workbench-source is-plugin"
  return "workbench-source"
}

function formatTime(ts: number | undefined): string {
  if (!ts) return ""
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function WorkbenchStatus({ activity }: { activity: ReturnType<typeof deriveSessionActivity> }): ReactElement {
  const tone = activity.state === "working" ? "is-working" : activity.state === "error" ? "is-error" : activity.state === "success" ? "is-success" : ""
  return <span className={`workbench-live-status ${tone}`}><span className="workbench-status-dot" />{activity.summary}</span>
}

/** Shared workbench terminal: ONE persistent shell per session that the human
 *  (this view) and the agent (terminal_send/terminal_read tools) drive
 *  together — either side's commands and their output are visible to both. */
function TerminalView({ sessionId }: { sessionId: string }): ReactElement {
  const controller = useMemo(() => terminalController(sessionId), [sessionId])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [command, setCommand] = useState("")
  const [historyIndex, setHistoryIndex] = useState(-1)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const element = outputRef.current
    if (!element) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) element.scrollTop = element.scrollHeight
  }, [snapshot.text])

  const run = async (): Promise<void> => {
    const next = command.trim()
    if (!next || snapshot.writing) return
    setCommand("")
    setHistoryIndex(-1)
    await controller.sendCommand(next)
    inputRef.current?.focus()
  }

  const onHistory = (direction: -1 | 1): void => {
    if (!snapshot.history.length) return
    const next = historyIndex < 0 && direction < 0
      ? snapshot.history.length - 1
      : Math.max(-1, Math.min(snapshot.history.length - 1, historyIndex + direction))
    setHistoryIndex(next)
    setCommand(next < 0 ? "" : snapshot.history[next] ?? "")
  }

  const recentActivity = snapshot.activity.slice(-6)

  return <div className="workbench-resource-view terminal-view">
    <div className="workbench-resource-toolbar">
      <div className="workbench-toolbar-heading"><TerminalSquare size={14} /><span>共享终端</span><span className={`workbench-shell-state ${snapshot.alive ? "is-alive" : ""}`}><span className="workbench-status-dot" />{snapshot.alive ? "shell 运行中 · 人/agent 共用" : "shell 空闲"}</span></div>
      <div className="workbench-toolbar-actions">{!snapshot.connected && <span className="workbench-toolbar-muted text-warn">未连接</span>}<button type="button" className="icon-btn !h-7 !w-7 text-bad" aria-label="发送 Ctrl+C" title="发送 Ctrl+C 到共享 shell" onClick={() => void controller.sendRaw("\u0003")}><Square size={11} fill="currentColor" /></button><button type="button" className="icon-btn !h-7 !w-7" aria-label="清空本地视图" title="清空本地视图（共享流继续）" disabled={!snapshot.text} onClick={() => controller.clearView()}><History size={13} /></button></div>
    </div>
    {recentActivity.length > 0 && <div className="workbench-shell-activity" aria-label="终端活动">{recentActivity.map((a, i) => <span key={`${a.ts}-${i}`} className={`workbench-shell-activity-item is-${a.source}`} title={`${a.source === "human" ? "人" : "agent"} · ${new Date(a.ts).toLocaleTimeString()}`}>{a.source === "human" ? "你" : "AI"}$ {a.text.length > 46 ? `${a.text.slice(0, 46)}…` : a.text}</span>)}</div>}
    <div ref={outputRef} className="workbench-terminal-output" role="log" aria-label="共享终端输出" aria-live="polite">
      {!snapshot.text ? <div className="workbench-empty-state"><TerminalSquare size={18} /><p>人与 agent 共用的同一个 shell</p><span>你在这里输入的命令 agent 能看到；agent 通过 terminal_send 跑的命令也会显示在这里。</span><code>git status</code></div> : <pre className="workbench-terminal-stream">{snapshot.text}</pre>}
    </div>
    <div className="workbench-terminal-input"><span className="workbench-command-prompt">&gt;</span><input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.ctrlKey && (event.key === "c" || event.key === "C")) { event.preventDefault(); void controller.sendRaw("\u0003"); return } if (event.key === "Enter" && command.trim() && !snapshot.writing) { event.preventDefault(); void run() } if (event.key === "ArrowUp" && !command) { event.preventDefault(); onHistory(-1) } if (event.key === "ArrowDown" && historyIndex >= 0) { event.preventDefault(); onHistory(1) } }} placeholder="输入命令，回车执行（与人/agent 共用同一 shell）" aria-label="终端命令" spellCheck={false} autoCapitalize="off" autoCorrect="off" />{snapshot.writing && <Loader2 size={12} className="spin text-ghost" />}</div>
    {snapshot.error && <div className="workbench-inline-error"><CircleAlert size={13} />{snapshot.error}</div>}
  </div>
}

function joinPath(path: string, name: string): string {
  return path === "." || path === "" ? name : `${path.replace(/[\\/]$/, "")}/${name}`
}

function parentPath(path: string): string {
  const clean = path.replace(/[\\/]$/, "")
  if (!clean || clean === ".") return "."
  return clean.split(/[\\/]/).slice(0, -1).join("/") || "."
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text)
}

function FilesView({ workspace, initialPath, onPathChange }: { workspace?: string; initialPath?: string | null; onPathChange?: (path: string | null) => void }): ReactElement {
  const [navigation, setNavigation] = useState(() => createFileNavigation(initialPath ? parentPath(initialPath) : "."))
  const path = navigation.path
  const [selected, setSelected] = useState<string | null>(initialPath ?? null)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const searchGeneration = useRef(0)
  const searchAbort = useRef<AbortController | null>(null)
  const clearSearch = (): void => {
    searchGeneration.current++
    searchAbort.current?.abort()
    setResults([])
    setSearching(false)
    setSearched(false)
    setSearchError(null)
  }
  useEffect(() => {
    clearSearch()
    setNavigation(createFileNavigation())
    setSelected(null)
    return () => { searchGeneration.current++; searchAbort.current?.abort() }
    // workspace changes require a fresh root and invalidate in-flight search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])
  const directory = useDirectory(workspace, path)
  const preview = useFilePreview(workspace, selected)

  useEffect(() => {
    if (!initialPath) return
    setSelected(initialPath)
    setNavigation((current) => reduceFileNavigation(current, { type: "push", path: parentPath(initialPath) }))
  }, [initialPath])

  const openEntry = (entry: FsEntry): void => {
    const next = joinPath(path, entry.name)
    if (entry.dir) {
      setNavigation((current) => reduceFileNavigation(current, { type: "push", path: next }))
      setSelected(null)
      return
    }
    setSelected(next)
    onPathChange?.(next)
  }

  const search = async (): Promise<void> => {
    const text = query.trim()
    if (!text || !workspace) {
      setResults([])
      return
    }
    clearSearch()
    const generation = ++searchGeneration.current
    const controller = new AbortController()
    searchAbort.current = controller
    setSearching(true)
    try {
      const found = await api.findFiles(text, workspace, { signal: controller.signal })
      if (controller.signal.aborted || generation !== searchGeneration.current) return
      setResults(found)
      setSearched(true)
    } catch (error) {
      if (controller.signal.aborted || generation !== searchGeneration.current) return
      setSearchError(error instanceof Error ? error.message : String(error))
    } finally {
      if (generation === searchGeneration.current) setSearching(false)
    }
  }

  const selectSearchResult = (result: string): void => {
    setSelected(result)
    setNavigation((current) => reduceFileNavigation(current, { type: "push", path: parentPath(result) }))
    setResults([])
    onPathChange?.(result)
  }

  return <div className="workbench-resource-view files-view">
    <div className="workbench-resource-toolbar"><div className="workbench-toolbar-heading"><FolderOpen size={14} /><span>工作区文件</span><span className="workbench-toolbar-muted">只读预览</span></div><div className="workbench-toolbar-actions"><button type="button" className="icon-btn !h-7 !w-7" aria-label="后退" title="后退" disabled={navigation.back.length === 0} onClick={() => { setNavigation((current) => reduceFileNavigation(current, { type: "back" })); setSelected(null); onPathChange?.(null) }}><ArrowLeft size={13} /></button><button type="button" className="icon-btn !h-7 !w-7" aria-label="前进" title="前进" disabled={navigation.forward.length === 0} onClick={() => { setNavigation((current) => reduceFileNavigation(current, { type: "forward" })); setSelected(null); onPathChange?.(null) }}><ArrowUpRight size={13} className="rotate-45" /></button><button type="button" className="icon-btn !h-7 !w-7" aria-label="返回上级目录" title="返回上级目录" disabled={path === "."} onClick={() => { setNavigation((current) => reduceFileNavigation(current, { type: "push", path: parentPath(path) })); setSelected(null); onPathChange?.(null) }}><ChevronRight size={13} className="-rotate-180" /></button><button type="button" className="icon-btn !h-7 !w-7" aria-label="刷新目录" title="刷新目录" onClick={directory.reload}><RefreshCw size={13} /></button></div></div>
    <div className="workbench-file-search"><Search size={13} /><input value={query} onChange={(event) => { clearSearch(); setQuery(event.target.value) }} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === "Enter") { event.preventDefault(); void search() } if (event.key === "Escape") { setQuery(""); clearSearch() } }} placeholder="搜索整个工作区…" aria-label="搜索工作区文件" /><button type="button" className="icon-btn !h-6 !w-6" aria-label="搜索文件" title="搜索文件" disabled={searching || !query.trim()} onClick={() => void search()}>{searching ? <Loader2 size={12} className="spin" /> : <Search size={12} />}</button></div>
    {searchError && <div className="workbench-inline-error">{searchError}</div>}{searched && !searching && !searchError && results.length === 0 && <div className="workbench-file-empty">未找到匹配文件</div>}{results.length > 0 && <div className="workbench-file-search-results" role="listbox" aria-label="文件搜索结果">{results.map((result) => <button key={result} type="button" role="option" onClick={() => selectSearchResult(result)}><FileCode2 size={12} /><span>{result}</span></button>)}</div>}
    <div className="workbench-files-body"><div className="workbench-file-list" role="tree" aria-label="工作区文件树"><div className="workbench-file-path"><button type="button" onClick={() => { setNavigation((current) => reduceFileNavigation(current, { type: "push", path: "." })); setSelected(null); onPathChange?.(null) }}>workspace</button>{path !== "." && path.split(/[\\/]/).filter(Boolean).map((part, index, parts) => { const crumb = parts.slice(0, index + 1).join("/"); return <span key={crumb} className="contents-inline-flex items-center gap-1"><ChevronRight size={11} /><button type="button" onClick={() => { setNavigation((current) => reduceFileNavigation(current, { type: "push", path: crumb })); setSelected(null); onPathChange?.(null) }}>{part}</button></span> })}</div>{directory.state.loading && <div className="workbench-inline-loading"><Spinner size={14} />加载目录…</div>}{!directory.state.loading && directory.state.error && <ErrorState message={directory.state.error} onRetry={directory.reload} className="py-10" />}{!directory.state.loading && !directory.state.error && directory.state.data?.entries.length === 0 && <div className="workbench-file-empty">目录为空</div>}{!directory.state.loading && !directory.state.error && directory.state.data?.entries.map((entry) => { const entryPath = joinPath(path, entry.name); return <button key={entryPath} type="button" role="treeitem" aria-selected={selected === entryPath} className={`workbench-file-row ${selected === entryPath ? "is-selected" : ""}`} onClick={() => openEntry(entry)} title={entryPath}>{entry.dir ? <Folder size={13} className="text-warn" /> : <FileCode2 size={13} className="text-interactive" />}<span>{entry.name}</span>{entry.dir && <ChevronRight size={12} />}</button> })}</div>{selected && <FilePreview path={selected} workspace={workspace} preview={preview} onClose={() => { setSelected(null); onPathChange?.(null) }} />}</div>
  </div>
}

function FilePreview({ path, preview, workspace, onClose }: { path: string; preview: { data: FileContent | null; error: string | null; loading: boolean; stale: boolean }; workspace?: string; onClose: () => void }): ReactElement {
  return <div className="workbench-file-preview"><div className="workbench-file-preview-header"><div className="min-w-0"><p className="truncate font-mono text-[11px] text-faint">{fileName(path)}</p><p className="truncate font-mono text-[10px] text-ghost">{path}</p></div><div className="flex items-center gap-1"><span className="workbench-file-kind">{langOf(path)}</span><button type="button" className="icon-btn !h-6 !w-6" aria-label="返回文件列表" title="返回文件列表" onClick={onClose}><ArrowLeft size={12} /></button><button type="button" className="icon-btn !h-6 !w-6" aria-label="复制相对路径" title="复制相对路径" onClick={() => copyText(path)}><Clipboard size={12} /></button><button type="button" className="icon-btn !h-6 !w-6" aria-label="在新标签页打开文件" title="在新标签页打开文件" onClick={() => window.open(`/v1/file?workspace=${encodeURIComponent(workspace ?? "")}&path=${encodeURIComponent(path)}`, "_blank", "noopener,noreferrer")}><ExternalLink size={12} /></button></div></div>{preview.loading && <div className="workbench-inline-loading"><Spinner size={14} />读取文件…</div>}{preview.error && <ErrorState message={preview.error} className="py-10" />}{preview.data && (preview.data.encoding === "base64" ? <div className="workbench-file-binary"><Braces size={18} /><p>二进制文件不提供文本预览。</p></div> : <pre className={`workbench-file-code ${preview.stale ? "is-stale" : ""}`}>{preview.data.content}</pre>)}{preview.data?.truncated && <p className="workbench-file-note">文件超过 2 MB，仅显示开头内容。</p>}</div>
}

function ActivityView({ activity, onOpenFile }: { activity: ReturnType<typeof deriveSessionActivity>; onOpenFile: (path: string) => void }): ReactElement {
  const [filter, setFilter] = useState<"all" | "confirmed" | "attempted" | "failed">("all")
  const filtered = filter === "all" ? activity.changes : activity.changes.filter((change) => change.state === filter)
  const confirmed = activity.changes.filter((change) => change.state === "confirmed").length
  const attempted = activity.changes.filter((change) => change.state === "attempted").length
  const failed = activity.changes.filter((change) => change.state === "failed").length
  return <div className="workbench-resource-view workbench-scroll activity-view"><div className="workbench-view-header"><div><p className="workbench-kicker">session evidence</p><h2>Agent 文件活动</h2><p>来源是会话事件，不等同于 Git 工作区状态。</p></div><span className="workbench-count">{activity.changes.length} 个文件</span></div><div className="workbench-filter-row" role="tablist" aria-label="文件活动筛选">{(["all", "confirmed", "attempted", "failed"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "全部" : value === "confirmed" ? `已完成 ${confirmed}` : value === "attempted" ? `进行中 ${attempted}` : `失败 ${failed}`}</button>)}</div>{filtered.length === 0 ? <div className="workbench-empty-state"><FileDiff size={18} /><p>{activity.changes.length ? "当前筛选没有记录" : "还没有文件活动"}</p><span>Agent 成功执行 write/edit 后会在这里留下可追溯记录。</span></div> : <div className="workbench-activity-list">{filtered.map((change) => <article key={`${change.path}-${change.turnSeq}`} className={`workbench-activity-item is-${change.state}`}><div className="workbench-activity-heading"><div className="min-w-0"><button type="button" className="workbench-path-button" onClick={() => onOpenFile(change.path)} title="在文件视图打开">{change.path}</button><div className="workbench-activity-meta"><span>{change.tool}</span><span>回合 {change.turnSeq ?? "?"}</span><span>{change.touches} 次触及</span></div></div><div className="workbench-diff-stat"><span className="text-ok">+{change.added}</span><span className="text-bad">-{change.removed}</span></div></div><div className="workbench-activity-state">{change.state === "confirmed" ? <><CircleCheck size={12} />已收到工具结果</> : change.state === "failed" ? <><CircleAlert size={12} />工具执行失败</> : <><Loader2 size={12} className="spin" />等待工具结果</>}</div><div className="workbench-activity-diff">{change.diff.slice(0, 8).map((line, index) => <div key={index} className={`cline ${line.kind}`}><span>{line.text || " "}</span></div>)}{change.diff.length > 8 && <span className="workbench-diff-more">+ {change.diff.length - 8} 行未展开</span>}</div></article>)}</div>}</div>
}

function PreviewView({ activity }: { activity: ReturnType<typeof deriveSessionActivity> }): ReactElement {
  return <div className="workbench-resource-view workbench-scroll preview-view"><div className="workbench-view-header"><div><p className="workbench-kicker">agent output</p><h2>产物</h2><p>工具生成的结果会在这里集中保留。</p></div><span className="workbench-count">{activity.panels.length} 个面板</span></div>{activity.panels.length === 0 ? <div className="workbench-empty-state"><FileText size={18} /><p>暂无产物</p><span>diff、Markdown、表格、图片和外部链接会显示在这里。</span></div> : <div className="workbench-panel-list">{activity.panels.map((panel) => <PanelCard key={panel.panelId} panel={panel} />)}</div>}</div>
}

function ContextView({ sessionId, state, reload }: { sessionId: string; state: ReturnType<typeof useSessionContext>["state"]; reload: () => void }): ReactElement {
  const data = state.data
  const context = data?.context
  const todos = data?.todos ?? []
  const completed = todos.filter((todo) => todo.status === "completed").length
  const ratio = context?.ratio ?? (context?.windowTokens ? context.estTokens / context.windowTokens : undefined)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const onRefresh = (): void => {
    setRefreshedAt(Date.now())
    reload()
  }
  // Capacity composition (image-1 style): a segmented bar + per-bucket legend,
  // percentages are shares of the USED capacity; the bar shows used/window.
  const fmtCap = (n: number): string => (n >= 10000 ? `${(n / 10000).toFixed(n >= 1_000_000 ? 0 : 1)}万` : `${n}`)
  const b = context?.breakdown
  const segments = [
    { key: "messages", label: "消息", tokens: b?.messagesTokens ?? 0, color: "var(--accent)" },
    { key: "builtin", label: "系统工具", tokens: b?.builtinToolsTokens ?? 0, color: "#7aa2f7" },
    { key: "other", label: "其他", tokens: b?.otherTokens ?? 0, color: "#9aa5ce" },
    { key: "mcp", label: "MCP 工具", tokens: b?.mcpToolsTokens ?? 0, color: "#bb9af7" },
    { key: "system", label: "系统提示词", tokens: b?.systemPromptTokens ?? 0, color: "#89ddff" },
  ].filter((s) => s.tokens > 0)
  const segSum = segments.reduce((n, s) => n + s.tokens, 0)
  const capacityPct = context?.windowTokens ? Math.round((context.estTokens / context.windowTokens) * 1000) / 10 : undefined
  return <div className="workbench-resource-view workbench-scroll context-view"><div className="workbench-view-header"><div><p className="workbench-kicker">session facts</p><h2>上下文</h2><p>这些信息来自当前 session 的持久化状态。</p></div><div className="flex flex-none items-center gap-1.5">{state.stale && <span className="workbench-refresh-note">刷新中…</span>}{refreshedAt && <span className="workbench-refresh-note">更新于 {new Date(refreshedAt).toLocaleTimeString()}</span>}<button type="button" className="icon-btn !h-7 !w-7" aria-label="刷新上下文" title="刷新上下文" onClick={onRefresh} disabled={state.loading && state.stale}>{state.loading && state.stale ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}</button></div></div>{state.loading && !data && <div className="workbench-inline-loading"><Spinner size={14} />读取 session 状态…</div>}{state.error && <div className="workbench-inline-warning"><CircleAlert size={13} />{state.error}</div>}{data && <div className="workbench-context-grid"><section className="workbench-fact"><div className="workbench-fact-heading"><Database size={14} /><span>上下文容量</span><strong>{context ? `${fmtCap(context.estTokens)}${context.windowTokens ? ` / ${fmtCap(context.windowTokens)}` : ""}${capacityPct !== undefined ? `（${capacityPct}%）` : ""}` : "-"}</strong></div>{context ? <><div className="workbench-capacity-bar">{segSum > 0 ? segments.map((s) => <span key={s.key} style={{ width: `${Math.max(0.8, (s.tokens / segSum) * 100)}%`, background: s.color }} title={`${s.label} ${Math.round((s.tokens / segSum) * 1000) / 10}%`} />) : <span style={{ width: `${Math.min(100, Math.max(2, (ratio ?? 0) * 100))}%`, background: "var(--accent)" }} />}</div>{segments.length > 0 && <div className="workbench-capacity-legend">{segments.map((s) => <div key={s.key} className="workbench-capacity-legend-row"><span className="workbench-capacity-dot" style={{ background: s.color }} /><span className="workbench-capacity-label">{s.label}</span><strong>{Math.round((s.tokens / segSum) * 1000) / 10}%</strong></div>)}</div>}{context.model || context.providerId ? <div className="workbench-token-ledger"><span className="workbench-ledger-label">模型</span><span className="workbench-ledger-value">{context.model ?? "-"}{context.providerId ? <em className="workbench-ledger-provider">@{context.providerId}</em> : null}</span></div> : null}{context.calls !== undefined ? <div className="workbench-token-ledger"><span className="workbench-ledger-label">模型调用</span><span className="workbench-ledger-value">{context.calls.toLocaleString()} 次{context.compacted ? ` · 已压缩${context.compactedAt ? ` ${new Date(context.compactedAt).toLocaleTimeString()}` : ""}` : ""}</span></div> : null}{(context.inputTokens ?? context.outputTokens ?? context.cacheReadTokens ?? context.reasoningTokens) ? <div className="workbench-token-facts"><span>输入 {context.inputTokens?.toLocaleString() ?? "0"}</span><span>输出 {context.outputTokens?.toLocaleString() ?? "0"}</span><span>缓存读 {context.cacheReadTokens?.toLocaleString() ?? "0"}</span><span>缓存写 {context.cacheWriteTokens?.toLocaleString() ?? "0"}</span><span>推理 {context.reasoningTokens?.toLocaleString() ?? "0"}</span>{context.avgCacheHitRate !== undefined && <span className={context.avgCacheHitRate > 0 ? "text-ok" : ""}>平均缓存命中率 {Math.round(context.avgCacheHitRate * 1000) / 10}%</span>}</div> : null}<p className="workbench-fact-note">超过 80% 时建议先压缩上下文；缓存/推理是消耗的子集，不重复计入估算。</p></> : <p className="workbench-fact-note">当前 session 没有上下文窗口数据。</p>}</section><section className="workbench-fact"><div className="workbench-fact-heading"><ShieldCheck size={14} /><span>执行策略</span><strong>{data.policy === "trusted" ? "完全访问" : data.policy === "readonly" ? "只读模式" : data.policy === "strict" ? "严格审批" : "未知"}</strong></div><p className="workbench-fact-note">策略由 session 持久化，工作台不会绕过审批。</p></section><section className="workbench-fact"><div className="workbench-fact-heading"><CircleDot size={14} /><span>目标与计划</span><strong>{todos.length ? `${completed}/${todos.length}` : "-"}</strong></div>{data.goal && <p className="workbench-goal-text">{"objective" in data.goal ? data.goal.objective : ""}</p>}{todos.length > 0 && <div className="workbench-todo-list">{todos.map((todo, index) => <div key={`${todo.content}-${index}`} className="workbench-todo-item">{todo.status === "completed" ? <CircleCheck size={12} className="text-ok" /> : todo.status === "in_progress" ? <Loader2 size={12} className="text-warn spin" /> : <CircleDot size={12} className="text-ghost" />}<span className={todo.status === "completed" ? "is-complete" : ""}>{todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content}</span></div>)}</div>}</section><p className="workbench-context-id">session {sessionId.slice(0, 12)}</p></div>}</div>
}

import { AgentsView } from "./AgentsView"
import { useApp } from "../state/store"
import { useMediaQuery } from "../lib/useMediaQuery"

export function WorkbenchPane({ pendingApprovals = 0, onOpenApprovals, onRequestedTabConsumed, requestedTab, sessionId, wsName, workspace, events, items, liveTurn, status, onClose }: { pendingApprovals?: number; onOpenApprovals?: () => void; onRequestedTabConsumed?: () => void; requestedTab?: { tab: string }; sessionId: string; wsName: string; workspace?: string; events: StoredEventRow[] | null; items: import("../api/fold").TranscriptItem[]; liveTurn?: LiveTurn; status?: string; onClose?: () => void }): ReactElement {
  const app = useApp()
  const children = app.sessions.filter((row) => row.parentId === sessionId && !row.archived)
  const drawerMode = useMediaQuery("(max-width: 1279px)")
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(() => readTab(sessionId))
  const [paneWidth, setPaneWidth] = useState(() => readPaneWidth(sessionId))
  const [resizing, setResizing] = useState(false)
  const [fileTarget, setFileTarget] = useState<string | null>(null)
  const context = useSessionContext(sessionId, events)
  const activity = useMemo(() => deriveSessionActivity({ events: events ?? [], items, liveTurn, context: context.state.data?.context, policy: context.state.data?.policy }), [context.state.data?.context, context.state.data?.policy, events, items, liveTurn])
  const providers = useWorkbenchProviders()
  const tabs = providers.map((provider) => provider.resource.id as WorkbenchTab)
  const activeProvider = providers.find((provider) => provider.resource.id === activeTab) ?? providers[0]!
  const activeId = activeProvider.resource.id as WorkbenchTab

  useEffect(() => { write(sessionKey(sessionId, "tab"), activeTab) }, [activeTab, sessionId])
  useEffect(() => { write(sessionKey(sessionId, "width"), paneWidth) }, [paneWidth, sessionId])
  useEffect(() => {
    if (!drawerMode) return
    const previous = document.activeElement
    const pane = document.querySelector<HTMLElement>(".workbench-pane")
    const buttons = () => Array.from(pane?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length)
    buttons()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose?.(); return }
      if (event.key !== "Tab") return
      const items = buttons()
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener("keydown", onKey)
    return () => { window.removeEventListener("keydown", onKey); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [drawerMode])
  useEffect(() => {
    if (!requestedTab) return
    setActiveTab(requestedTab.tab as WorkbenchTab)
    onRequestedTabConsumed?.()
  }, [requestedTab, onRequestedTabConsumed])
  useEffect(() => { if (!providers.some((provider) => provider.resource.id === activeTab)) setActiveTab(providers[0]?.resource.id ?? "terminal") }, [activeTab, providers])

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    const current = tabs.indexOf(activeId)
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
    const nextTab = tabs[next]!
    setActiveTab(nextTab)
    requestAnimationFrame(() => document.getElementById(`workbench-tab-${nextTab}`)?.focus())
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizing) setPaneWidth(Math.min(PANE_MAX, Math.max(PANE_MIN, window.innerWidth - event.clientX)))
  }
  const stopResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setResizing(false)
  }
  const nudgeWidth = (delta: number): void => setPaneWidth((current) => Math.min(PANE_MAX, Math.max(PANE_MIN, current + delta)))
  const openFile = useCallback((path: string) => { setFileTarget(path); setActiveTab("files") }, [])
  const activeBuiltin = BUILTIN_TABS.includes(activeId as BuiltinWorkbenchTab) ? activeId as BuiltinWorkbenchTab : null
  const renderExternal = activeProvider.render
  const providerReady = activeProvider.resource.state === "ready"
  const providerStateLabel = activeProvider.resource.state === "error" ? "资源加载失败" : activeProvider.resource.state === "loading" ? "正在连接资源" : activeProvider.resource.state === "unavailable" ? "资源未接入" : "资源已接入"
  const providerContext = { sessionId, wsName, ...(workspace ? { workspace } : {}), activity, openTab: setActiveTab, close: onClose ?? (() => {}) }
  const content = !providerReady ? <div className="workbench-empty-state"><CircleOff size={16} /><p>{providerStateLabel}</p><span>{activeProvider.resource.description}</span></div>
    : activeBuiltin === "agents" ? <AgentsView children={children} />
    : activeBuiltin === "terminal" ? <TerminalView sessionId={sessionId} />
    : activeBuiltin === "files" ? <FilesView workspace={workspace} initialPath={fileTarget} onPathChange={setFileTarget} />
    : activeBuiltin === "activity" ? <ActivityView activity={activity} onOpenFile={openFile} />
    : activeBuiltin === "preview" ? <PreviewView activity={activity} />
    : activeBuiltin === "context" ? <ContextView sessionId={sessionId} state={context.state} reload={context.reload} />
    : providerReady && renderExternal ? renderExternal(providerContext) : <div className="workbench-empty-state"><CircleOff size={20} /><p>{providerStateLabel}</p><span>{activeProvider.resource.description}</span><code>{activeProvider.resource.source}:{activeProvider.resource.id}</code></div>

  return <><div className="workbench-scrim" onClick={onClose} aria-hidden="true" /><aside data-pane className={`workbench-pane ${resizing ? "is-resizing" : ""}`} style={{ "--pane-w": `${paneWidth}px` } as CSSProperties} role={drawerMode ? "dialog" : "complementary"} aria-modal={drawerMode || undefined} aria-label="资源工作台">
    <div className="workbench-resize-handle" role="separator" aria-label="调整工作台宽度" aria-orientation="vertical" aria-valuenow={paneWidth} aria-valuemin={PANE_MIN} aria-valuemax={PANE_MAX} tabIndex={0} onPointerDown={startResize} onPointerMove={resize} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); nudgeWidth(24) } if (event.key === "ArrowRight") { event.preventDefault(); nudgeWidth(-24) } if (event.key === "Home") { event.preventDefault(); setPaneWidth(PANE_MIN) } if (event.key === "End") { event.preventDefault(); setPaneWidth(PANE_MAX) } }} />
    <section className="workbench-surface"><header className="workbench-surface-header"><div className="min-w-0"><div className="workbench-resource-title"><div className="min-w-0"><h2>{activeProvider.resource.label}</h2></div></div></div><div className="workbench-header-actions"><span className={sourceClass(activeProvider.resource.source)}>{sourceLabel(activeProvider.resource.source)}</span><button type="button" className="icon-btn !h-7 !w-7" aria-label="关闭工作台" title="关闭工作台" onClick={onClose}><PanelRightClose size={14} /></button></div></header>
      {drawerMode && pendingApprovals > 0 && <div className="flex-none border-b border-line bg-panel px-3 py-2" aria-live="polite"><button type="button" className="btn w-full justify-center !text-warn" onClick={onOpenApprovals} aria-label={`处理 ${pendingApprovals} 个待处理决定，关闭工作台并转到审批`}><ShieldCheck size={15} />待处理决定 ({pendingApprovals})</button></div>}
      <nav className="workbench-surface-tabs" role="tablist" aria-label="工作台资源"><span className="workbench-tabs-label">资源</span>{providers.map((provider) => { const tab = provider.resource.id as WorkbenchTab; const count = tab === "agents" ? children.length : tab === "activity" ? activity.changes.length : tab === "preview" ? activity.panels.length : 0; return <button key={tab} id={`workbench-tab-${tab}`} type="button" role="tab" aria-selected={activeId === tab} aria-controls={`workbench-panel-${tab}`} tabIndex={activeId === tab ? 0 : -1} className={`workbench-surface-tab ${activeId === tab ? "is-active" : ""}`} onClick={() => setActiveTab(tab)} onKeyDown={onTabKeyDown}>{tabIcon(tab)}<span>{provider.resource.label}</span>{count > 0 && <span className="workbench-tab-count">{count}</span>}</button> })}</nav>
      <div id={`workbench-panel-${activeId}`} className="workbench-surface-body" role="tabpanel" aria-label={activeProvider.resource.label} aria-labelledby={`workbench-tab-${activeId}`}>{content}</div>
    </section>
  </aside></>
}
