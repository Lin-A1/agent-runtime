/**
 * Sidebar — ZCode remote v4 style navigation rail:
 *   brand · 新建任务/搜索 actions (REAL: Ctrl/Cmd+N / Ctrl+K) ·
 *   scope segmented (全部 | 项目) · collapsible project group with the
 *   session tree (subagents nested) · bottom user bar. Every control is real.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { useNavigate } from "react-router-dom"
import {
  ChevronDown,
  ChevronRight,
  Eraser,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react"
import { api } from "../api/client"
import { formatRelativeTime, prettyTitle } from "../api/fold"
import type { SessionRow } from "../api/types"
import { useApp, useStream } from "../state/store"
import { normWorkspace } from "../lib/workspace"
import { useTheme } from "../lib/theme"
import { Spinner } from "./ui"
import { ProviderPicker } from "./ProviderPicker"
import { EmotionBall } from "./EmotionBall"
import { BrandWordmark } from "./BrandWordmark"

function StatusDot({ row, busy }: { row: SessionRow; busy: boolean }): ReactElement {
  return (
    <span
      className={`dot flex-none ${
        busy || row.status === "active" ? "dot-active" : row.status === "interrupted" ? "dot-error" : "dot-settled"
      }`}
    />
  )
}

function SubagentItem({
  subagent,
  selected,
  onSelect,
}: {
  subagent: SessionRow
  selected: boolean
  onSelect?: () => void
}): ReactElement {
  const navigate = useNavigate()
  const { live } = useStream()
  const busy = !!live.get(subagent.sessionId)?.busy
  const relTime = formatRelativeTime(subagent.updatedAt)

  return (
    <button
      type="button"
      className={`flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-xs transition-colors select-none ${
        selected ? "bg-hover-2 text-fg font-medium" : "text-dim hover:bg-hover-2 hover:text-fg"
      }`}
      onClick={() => {
        navigate(`/s/${subagent.sessionId}`)
        onSelect?.()
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {subagent.origin === "dag" ? (
          <GitBranch size={11} className="flex-none text-trajreasoning" />
        ) : (
          <Sparkles size={11} className="flex-none text-accent" />
        )}
        <span
          className={`dot flex-none scale-75 ${
            busy || subagent.status === "active" ? "dot-active" : subagent.status === "interrupted" ? "dot-error" : "dot-settled"
          }`}
        />
        <span className="min-w-0 truncate font-mono text-2xs">{prettyTitle(subagent.title, "子任务")}</span>
      </div>
      {relTime && <span className="flex-none pl-1 font-mono text-2xs text-faint">{relTime}</span>}
    </button>
  )
}

function Row({
  row,
  selected,
  selectedId,
  subagents,
  onDeleteDone,
  onSelect,
}: {
  row: SessionRow
  selected: boolean
  selectedId?: string
  subagents?: SessionRow[]
  onDeleteDone: (deletedId: string) => void
  onSelect?: () => void
}): ReactElement {
  const navigate = useNavigate()
  const { live } = useStream()
  const { refreshSessions } = useApp()
  const [confirming, setConfirming] = useState<"delete" | "clear" | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)

  const hasChildren = subagents !== undefined && subagents.length > 0
  const isChildSelected = hasChildren && subagents.some((c) => c.sessionId === selectedId)
  const [expanded, setExpanded] = useState(selected || isChildSelected)

  useEffect(() => {
    if (selected || isChildSelected) setExpanded(true)
  }, [selected, isChildSelected])

  const busy = !!live.get(row.sessionId)?.busy
  const isButler = row.role === "butler"
  const relTime = formatRelativeTime(row.updatedAt)

  const doDelete = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setDeleting(true)
    void api
      .deleteSession(row.sessionId)
      .then(() => {
        setConfirming(null)
        setDeleting(false)
        refreshSessions()
        onDeleteDone(row.sessionId)
      })
      .catch(() => {
        setDeleting(false)
        setDeleteFailed(true)
      })
  }

  const doClear = (e: React.MouseEvent): void => {
    // Butler resident "clean session": wipe the whole conversation history but
    // keep the resident session itself. truncate atSeq 0 keeps Session.Created;
    // the system context is re-injected on the next prompt (ensureSystemContext).
    e.stopPropagation()
    setDeleting(true)
    void api
      .truncateSession(row.sessionId, 0)
      .then(() => {
        setConfirming(null)
        setDeleting(false)
        refreshSessions()
      })
      .catch(() => {
        setDeleting(false)
        setDeleteFailed(true)
      })
  }

  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation()
        setConfirming(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirming])

  if (confirming) {
    const isClear = confirming === "clear"
    return (
      <div className="flex h-8 w-full items-center justify-between rounded-md border border-bad/30 bg-bad/10 px-2 text-xs select-none">
        <span className="truncate text-2xs font-medium text-bad">{deleteFailed ? (isClear ? "清理失败，请重试" : "删除失败，请重试") : isClear ? "清空全部对话历史？" : "确认删除？"}</span>
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            autoFocus
            className="rounded px-1.5 py-0.5 text-2xs text-dim transition-colors hover:bg-hover hover:text-fg"
            onClick={(e) => {
              e.stopPropagation()
              setConfirming(null)
            }}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded bg-bad px-2 py-0.5 text-2xs font-medium text-white transition-colors hover:bg-bad/90"
            disabled={deleting}
            onClick={isClear ? doClear : doDelete}
          >
            {deleting ? <Spinner size={10} /> : isClear ? "清空" : "删除"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="group relative flex items-center">
        <button
          type="button"
          className={`flex h-10 w-full items-center justify-between rounded-md px-2.5 text-left text-[13px] transition-colors select-none ${
            selected ? "bg-hover-2 text-fg font-medium" : isChildSelected ? "bg-surface/50 text-fg" : "text-dim hover:bg-hover-2 hover:text-fg"
          }`}
          onClick={() => {
            navigate(`/s/${row.sessionId}`)
            onSelect?.()
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isButler ? (
              <EmotionBall mood={busy ? "thinking" : "idle"} size={17} lite hasRing={false} />
            ) : (
              <StatusDot row={row} busy={busy} />
            )}
            <span className="min-w-0 truncate font-sans text-xs">
              {isButler ? "newhorse" : prettyTitle(row.title, "未命名会话")}
            </span>
            {isButler && <span className="flex-none rounded bg-field px-1 py-px text-2xs text-faint select-none">常驻</span>}
            {hasChildren && (
              <span className="flex-none rounded bg-field px-1 font-mono text-2xs text-faint">{subagents.length}</span>
            )}
          </div>

          {/* Relative time (ZCode style; touch has no hover so keep it visible) */}
          {relTime && <span className="max-sm:hidden pl-1 font-mono text-2xs text-faint group-hover:hidden">{relTime}</span>}
        </button>

        {/* Tree expansion toggle — a SIBLING of the row button (valid DOM) */}
        {hasChildren && (
          <button
            type="button"
            className="absolute right-8 flex h-6 w-6 items-center justify-center rounded text-ghost transition-colors hover:bg-hover-2 hover:text-dim"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            title={expanded ? "收起子代理" : "展开子代理"}
          >
            <ChevronRight size={11} className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
          </button>
        )}

        {!isButler && (
          <button
            type="button"
            className="icon-btn absolute right-1.5 !h-6 !w-6 text-faint opacity-75 transition-opacity hover:bg-bad/10 hover:!text-bad group-hover:opacity-100 sm:opacity-0"
            title="删除会话"
            onClick={(e) => {
              e.stopPropagation()
              setConfirming("delete")
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
        {isButler && (
          <button
            type="button"
            className="icon-btn absolute right-1.5 !h-6 !w-6 text-faint opacity-75 transition-opacity hover:bg-warn/10 hover:!text-warn group-hover:opacity-100 sm:opacity-0"
            title="清理会话（清空对话历史）"
            aria-label="清理会话"
            onClick={(e) => {
              e.stopPropagation()
              setConfirming("clear")
            }}
          >
            <Eraser size={12} />
          </button>
        )}
      </div>

      {expanded && hasChildren && (
        <div className="my-0.5 ml-3.5 flex flex-col gap-0.5 border-l border-line/50 pl-2.5">
          {subagents.map((child) => (
            <SubagentItem
              key={child.sessionId}
              subagent={child}
              selected={selectedId === child.sessionId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

import { useMediaQuery } from "../lib/useMediaQuery"

export function Sidebar({
  selectedId,
  mobileOpen = false,
  onCloseMobile,
  onOpenMobile,
}: {
  onOpenMobile?: () => void
  selectedId?: string
  mobileOpen?: boolean
  onCloseMobile?: () => void
}): ReactElement {
  const navigate = useNavigate()
  const { sessions, sessionsLoading, sessionsError, refreshSessions, workspace } = useApp()
  const { theme, toggle } = useTheme()
  // Scope switch (ZCode segmented control): 项目 = current workspace, 全部 = all
  const [scope, setScope] = useState<"all" | "project">("project")
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("newhorse:sidebar:collapsed") === "true")
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  useEffect(() => { localStorage.setItem("newhorse:sidebar:collapsed", String(collapsed)) }, [collapsed])
  const isMobile = useMediaQuery("(max-width: 767px)")
  const drawerOpen = mobileOpen && isMobile
  const searchRef = useRef<HTMLInputElement>(null)

  const { butler, groups } = useMemo(() => {
    const visible = sessions.filter((r) => !r.archived)
    const inWs = visible.filter((r) => normWorkspace(r.workspace) === workspace)
    const butlerRow = inWs.find((r) => r.role === "butler")

    // Grouping: "项目" = one group per project/workspace (a session created in
    // another workspace — newProject — appears under its OWN project group, never
    // hidden just because it differs from the global workspace). "全部" = the
    // same top-level sessions flattened by recency, no group headers.
    const topLevel = visible.filter((r) => r.role !== "butler" && !r.parentId).sort((a, b) => b.updatedAt - a.updatedAt)
    const byWs = new Map<string, SessionRow[]>()
    for (const r of topLevel) {
      const ws = normWorkspace(r.workspace) || "默认"
      byWs.set(ws, [...(byWs.get(ws) ?? []), r])
    }
    const wsGroups = [...byWs.entries()]
      .map(([ws, rows]) => ({ ws, rows }))
      .sort((a, b) => b.rows[0]!.updatedAt - a.rows[0]!.updatedAt)

    const groupsOut = scope === "project" ? wsGroups : [{ ws: "", rows: topLevel }]
    const normalized = query.trim().toLowerCase()
    if (!normalized) return { butler: butlerRow, groups: groupsOut }
    return {
      butler: butlerRow && ("newhorse".includes(normalized) ? butlerRow : undefined),
      groups: groupsOut.map((group) => ({ ...group, rows: group.rows.filter((row) => prettyTitle(row.title, "未命名会话").toLowerCase().includes(normalized)) })).filter((group) => group.rows.length > 0),
    }
  }, [sessions, workspace, scope, query])

  const onDeleted = (deletedId: string): void => {
    if (selectedId === deletedId) navigate("/")
  }

  const newTask = (): void => {
    void api
      .createSession(undefined, workspace || undefined)
      .then((r) => {
        void refreshSessions()
        navigate(`/s/${r.sessionId}`)
        onCloseMobile?.()
      })
      .catch(() => {})
  }

  const newProject = (): void => {
    // A project = a real workspace directory the session pins to (fs tools and
    // the terminal chroot there). Browsers cannot expose an absolute path from a
    // directory picker, so we ask for a path explicitly; the server mkdir -p's
    // it on session create, so a not-yet-created path still works. The picker is
    // only a convenience that fills a name-based relative path.
    const pick = async (): Promise<string | null> => {
      // File System Access API is not in the TS DOM lib; guard + cast.
      const w = window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<{ name: string }> }
      if (typeof w.showDirectoryPicker === "function") {
        try {
          const handle = await w.showDirectoryPicker({ mode: "readwrite" })
          return handle.name
        } catch {
          return null // cancelled — fall through to manual entry
        }
      }
      return null
    }
    void (async () => {
      const name = (await pick()) ?? window.prompt("输入新项目的目录路径（不存在会自动创建）", "./my-project")
      const pname = name?.trim()
      if (!pname) return
      void api
        .createSession(undefined, pname, false, pname)
        .then((r) => {
          void refreshSessions()
          navigate(`/s/${r.sessionId}`)
          onCloseMobile?.()
        })
        .catch(() => {})
    })()
  }

  useEffect(() => {
    const onSearch = (): void => {
      setSearchOpen(true)
      setCollapsed(false)
      if (isMobile) onOpenMobile?.()
      requestAnimationFrame(() => searchRef.current?.focus())
    }
    window.addEventListener("nh-open-search", onSearch)
    return () => window.removeEventListener("nh-open-search", onSearch)
  }, [isMobile, onOpenMobile])

  useEffect(() => {
    if (!searchOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSearchOpen(false)
        setQuery("")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [searchOpen])

  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const drawer = document.querySelector<HTMLElement>('[aria-label="会话导航"]')
    const controls = () => Array.from(drawer?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length)
    controls()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseMobile?.(); return }
      if (event.key !== "Tab") return
      const items = controls()
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [drawerOpen])

  const wsName = workspace ? workspace.split(/[/\\]/).filter(Boolean).pop() ?? "newhorse" : "newhorse"

  const sidebarContent = (
    <div className={`flex h-full w-full flex-col bg-side pt-safe-top ${collapsed && !isMobile ? "sidebar-collapsed" : ""}`}>
      {/* Brand Header */}
      <div className="flex flex-none items-center justify-between px-3 pb-2 pt-2 sm:pt-3">
        <BrandWordmark size="md" onClick={onCloseMobile} />
          <div className="flex items-center gap-0.5">
          <button type="button" className="icon-btn !h-7 !w-7 text-ghost hover:text-dim md:inline-flex hidden" title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}</button>
          <button
            type="button"
            className="icon-btn !h-7 !w-7 text-ghost hover:text-dim"
            title={theme === "dark" ? "切换为明亮主题" : "切换为暗色主题"}
            onClick={toggle}
          >
            {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
          </button>
          {onCloseMobile && (
            <button
              type="button"
              className="icon-btn !h-8 !w-8 text-ghost hover:text-dim md:hidden"
              title="关闭侧边栏"
              onClick={onCloseMobile}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Top Actions (all REAL: new task + new project + search palette) */}
      <div className="flex flex-none flex-col gap-0.5 border-b border-line/40 px-2.5 pb-2 pt-1">
        <button
          type="button"
          onClick={newTask}
          className="flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs font-medium text-ink transition-colors select-none hover:bg-hover-2"
        >
          <div className="flex items-center gap-2">
            <Plus size={14} className="text-dim" />
            <span>新建任务</span>
          </div>
          <span className="font-mono text-[10px] text-faint">Ctrl+N</span>
        </button>
        <button
          type="button"
          onClick={newProject}
          className="flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs text-dim transition-colors select-none hover:bg-hover-2 hover:text-ink"
        >
          <div className="flex items-center gap-2">
            <FolderPlus size={14} className="text-dim" />
            <span>新建项目</span>
          </div>
          <span className="font-mono text-[10px] text-faint">项目</span>
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("nh-open-search"))}
          className="flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs text-dim transition-colors select-none hover:bg-hover-2 hover:text-ink"
        >
          <div className="flex items-center gap-2">
            <Search size={14} className="text-dim" />
            <span>搜索</span>
          </div>
          <span className="font-mono text-[10px] text-faint">Ctrl+K</span>
        </button>
      </div>

      {/* Scope segmented control (ZCode: 全部 | 项目) + workspace */}
      <div className="flex flex-none items-center gap-1 px-2.5 pb-1 pt-2.5">
        <div className="inline-flex items-center rounded-md border border-line bg-bg2 p-0.5">
          {(["project", "all"] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScope(sc)}
              className={`rounded px-2 py-0.5 text-2xs transition-colors cursor-pointer select-none ${
                scope === sc ? "bg-hover-2 text-fg font-medium" : "text-faint hover:text-dim"
              }`}
            >
              {sc === "project" ? "项目" : "全部"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 font-mono text-2xs text-faint">
          <Folder size={11} className="opacity-60" />
          <span>{wsName}</span>
        </div>
      </div>

      {searchOpen && (
        <div className="sidebar-search-wrap">
          <Search size={13} className="flex-none text-ghost" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选当前会话…"
            aria-label="筛选当前会话"
            className="sidebar-search-input"
          />
          {query && (
            <button
              type="button"
              className="icon-btn !h-6 !w-6"
              title="清空筛选"
              aria-label="清空筛选"
              onClick={() => {
                setQuery("")
                searchRef.current?.focus()
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Session tree */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-safe">
        {sessionsLoading && (
          <div className="flex justify-center py-8">
            <Spinner size={15} />
          </div>
        )}
        {sessionsError && <div className="px-2 py-4 text-xs text-bad">{sessionsError}</div>}

        {butler && (
          <div className="mb-1">
            <Row
              row={butler}
              selected={selectedId === butler.sessionId}
              selectedId={selectedId}
              onDeleteDone={onDeleted}
              onSelect={onCloseMobile}
            />
          </div>
        )}

        {groups.map((g) => (
          <div key={g.ws || "all"} className="mb-1">
            {g.ws ? (
              <button type="button" aria-expanded={!collapsedGroups[g.ws]} className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-2xs font-medium text-faint select-none hover:text-fg" onClick={() => setCollapsedGroups((current) => ({ ...current, [g.ws]: !current[g.ws] }))}>
                {collapsedGroups[g.ws] ? <ChevronRight size={11} /> : <ChevronDown size={11} />}<FolderOpen size={11} className="opacity-70" /><span className="min-w-0 truncate">{g.ws.split(/[/\\]/).filter(Boolean).pop()}</span><span className="ml-auto font-mono text-2xs text-ghost">{g.rows.length}</span>
              </button>
            ) : null}
            {(!g.ws || !collapsedGroups[g.ws]) && <div className="flex flex-col gap-0.5">
              {g.rows.map((r) => (
                <Row
                  key={r.sessionId}
                  row={r}
                  selected={selectedId === r.sessionId}
                  selectedId={selectedId}
                  onDeleteDone={onDeleted}
                  onSelect={onCloseMobile}
                />
              ))}
            </div>}
          </div>
        ))}

        {!sessionsLoading && !sessionsError && groups.length === 0 && !butler && (
          <div className="px-3 py-6 text-center text-xs text-faint">
            暂无会话
            <br />
            点击「新建任务」开始
          </div>
        )}
      </div>

      {/* Bottom user bar + provider/model switcher */}
      <div className="flex flex-none flex-col gap-1 border-t border-line px-2 py-2 text-xs select-none">
        <div className="flex items-center justify-between px-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-field font-mono text-[10px] font-bold text-ink">N</span>
            <span className="truncate text-xs font-medium text-ink-2">newhorse</span>
          </div>
        </div>
        <ProviderPicker />
      </div>
    </div>
  )

  return (
    <>
      {drawerOpen && <div className="fixed inset-0 z-50 bg-black/60" onClick={onCloseMobile} aria-hidden="true" />}
      <aside role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen || undefined} aria-label="会话导航" className={drawerOpen ? "fixed inset-y-0 left-0 z-[60] flex w-72 max-w-[82vw] flex-col border-r border-line bg-side shadow-overlay" : `hidden flex-none flex-col border-r border-line bg-side md:flex ${collapsed ? "w-14" : "w-[268px]"}`}>
        {sidebarContent}
      </aside>
    </>
  )
}
