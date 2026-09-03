/**
 * Left sidebar — workspace identity block up top, the resident newhorse
 * session pinned beneath it (mini-ball avatar), sessions in timeline groups
 * (今天/昨天/本周/上周/本月/更早) with status dots, an archived group, and
 * a usage/settings footer. Mirrors ZCode's workspaceSidebar density.
 */
import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  Archive,
  Ellipsis, PencilLine, ArchiveRestore, Trash2,
  Check,
  ChevronsUpDown,
  Clock,
  FolderGit2,
  PanelLeftOpen,
  Plus,
  QrCode,
  Search,
  Settings as SettingsIcon,
  SunMoon,
} from "lucide-react"
import { api } from "../api/client"
import { useBusRefresh } from "../api/bus"
import type { SessionRow, SettingsView } from "../api/types"
import { relativeTime, sessionDisplayName } from "../api/fold"
import { normWorkspace, useWorkspace } from "../lib/workspace"
import { useApi } from "../lib/useApi"
import { EmotionBall } from "./EmotionBall"
import { Dropdown, MenuItem, Modal, Spinner, StatusDot } from "./ui"
import { useTheme } from "../lib/theme"

type GroupKey = "今天" | "昨天" | "本周" | "上周" | "本月" | "更早"

function groupOf(ts: number): GroupKey {
  const d = new Date(ts)
  const now = new Date()
  const dayStart = (t: Date): Date => new Date(t.getFullYear(), t.getMonth(), t.getDate())
  const diffDays = Math.round((dayStart(now).getTime() - dayStart(d).getTime()) / 86_400_000)
  if (diffDays <= 0) return "今天"
  if (diffDays === 1) return "昨天"
  if (diffDays <= 7) return "本周"
  if (diffDays <= 14) return "上周"
  if (diffDays <= 31) return "本月"
  return "更早"
}
const GROUP_ORDER: GroupKey[] = ["今天", "昨天", "本周", "上周", "本月", "更早"]

export function Sidebar({ onOpenRemote, collapsed, onToggleCollapse }: { onOpenRemote?: () => void; collapsed?: boolean; onToggleCollapse?: () => void } = {}): React.ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const { toggle, theme } = useTheme()
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [])
  const settings = useApi<SettingsView>(() => api.settings(), [])
  // Workspace partition: distinct workspaces derive from the engine default
  // (settings.workspace) + every session's workspace; selection persists and
  // filters the project list. Free tasks (no workspace) stay global.
  const [ws, setWs] = useWorkspace(settings.data?.workspace)
  const workspaces = useMemo(() => {
    const seen = new Set<string>()
    // The current selection belongs in the list even when it has no sessions
    // yet (a custom path) — otherwise reopening the switcher makes the
    // selection look lost.
    for (const w of [settings.data?.workspace, ws, ...(sessions.data ?? []).map((r) => r.workspace)]) {
      if (w && w !== "") seen.add(normWorkspace(w))
    }
    return [...seen]
  }, [settings.data?.workspace, ws, sessions.data])
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [wsInputOpen, setWsInputOpen] = useState(false)
  const [wsDraft, setWsDraft] = useState("")

  const newTask = (): void => {
    if (creating) return
    setCreating(true)
    void api.createSession(undefined, ws || undefined)
      .then((r) => navigate(`/session/${r.sessionId}`))
      .catch((e) => window.alert("新建会话失败：" + (e instanceof Error ? e.message : String(e))))
      .finally(() => setCreating(false))
  }

  const { resident, groups, archived, freeTasks } = useMemo(() => {
    const rows = sessions.data ?? []
    // Free tasks = not bound to any project workspace (项目 vs 任务 split).
    const projectRows = rows.filter((r) => r.workspace && r.workspace !== "" && (!ws || normWorkspace(r.workspace) === ws))
    const freeTasks = rows
      .filter((r) => !r.workspace && !r.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const resident = projectRows.find((r) => r.role === "butler" && !r.archived)
    const rest = projectRows.filter((r) => r.role !== "butler")
    const groups = new Map<GroupKey, SessionRow[]>()
    const archived: SessionRow[] = []
    for (const r of rest) {
      if (r.archived) {
        archived.push(r)
        continue
      }
      const g = groupOf(r.updatedAt)
      groups.set(g, [...(groups.get(g) ?? []), r])
    }
    for (const list of groups.values()) list.sort((a, b) => b.updatedAt - a.updatedAt)
    return { resident, groups, archived, freeTasks }
  }, [sessions.data, ws])

  // Sessions poll (handoff §6.7): 4s keeps status dots honest across
  // devices and engines without a push channel. MUST stay above the
  // collapsed early-return — hooks cannot live behind a conditional.
  useEffect(() => {
    const t = setInterval(() => sessions.retry(), 4_000)
    return () => clearInterval(t)
  }, [])
  // Push refresh: the global bus settles turns faster than the poll.
  useBusRefresh(
    (f) => f.event.type === "result" || f.event.type === "done" || f.event.type === "error",
    sessions.retry,
  )

  if (collapsed) {
    return <CollapsedRail onOpenRemote={onOpenRemote} onExpand={onToggleCollapse} onHome={() => navigate("/")} onSettings={() => navigate("/settings")} />
  }

  const q = query.trim().toLowerCase()
  const match = (r: SessionRow): boolean => !q || (r.title ?? "").toLowerCase().includes(q) || r.sessionId.toLowerCase().includes(q)

  return (
    <aside className="flex h-full w-[248px] flex-none flex-col border-r border-line bg-side">
      {/* workspace identity — compact, like a chat-client project switcher */}
      <div className="relative px-3 pt-3">
        <button
          onClick={onToggleCollapse}
          className="icon-btn absolute -right-0.5 top-3 z-10 !h-7 !w-7 opacity-60 hover:opacity-100"
          title="折叠侧栏"
        >
          <PanelLeftOpen size={15} style={{ transform: "scaleX(-1)" }} />
        </button>
        <Dropdown
          width={256}
          trigger={
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover">
              <FolderGit2 size={17} className="flex-none text-dim" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{ws ? ws.replace(/\/+$/, "").split("/").pop() : "newhorse"}</span>
              <ChevronsUpDown size={14} className="flex-none text-ghost" />
            </button>
          }
        >
          {(close) => (
            <>
              <div className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-ghost">当前工作区</div>
              <div className="mx-1 mb-1 rounded-md bg-bg2 px-2 py-1.5">
                <div className="truncate font-mono text-2xs text-faint">{ws || "（未选择）"}</div>
              </div>
              <div className="px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wide text-ghost">切换工作区</div>
              {workspaces.length === 0 && <div className="px-3 py-2 text-2xs text-ghost">还没有会话产生工作区</div>}
              {workspaces.map((w) => (
                <MenuItem
                  key={w}
                  icon={w === ws ? <Check size={14} className="text-fg" /> : <span className="w-[14px]" />}
                  onClick={() => {
                    setWs(w)
                    close()
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{w.replace(/\/+$/, "").split("/").pop()}</span>
                    <span className="block truncate font-mono text-2xs text-ghost">{w}</span>
                  </span>
                </MenuItem>
              ))}
              <div className="menu-sep" />
              <MenuItem
                icon={<Plus size={14} />}
                onClick={() => {
                  // 引擎默认工作区之外的自定义路径：window.prompt 在 webview
                  // 里不可用，走真模态框。
                  setWsDraft(ws)
                  setWsInputOpen(true)
                  close()
                }}
              >
                输入其他工作区路径…
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>

      {/* custom workspace path — a real modal (window.prompt is dead in webviews) */}
      <Modal open={wsInputOpen} onClose={() => setWsInputOpen(false)} title="输入工作区路径" width={420}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const p = wsDraft.trim()
            if (!p) return
            setWs(p)
            setWsInputOpen(false)
          }}
        >
          <input
            autoFocus
            value={wsDraft}
            onChange={(e) => setWsDraft(e.target.value)}
            placeholder="绝对路径，如 G:/Code/my-project"
            className="input w-full font-mono text-xs"
          />
          <p className="mt-2 text-2xs leading-relaxed text-ghost">引擎按此路径创建/过滤会话；路径不存在时该工作区为空。</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn text-xs" onClick={() => setWsInputOpen(false)}>取消</button>
            <button type="submit" className="btn btn-primary text-xs" disabled={!wsDraft.trim()}>保存</button>
          </div>
        </form>
      </Modal>

      {/* new task + search */}
      <div className="flex items-center gap-1.5 px-3 pt-3">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-dim transition-colors hover:bg-hover hover:text-fg"
          disabled={creating}
          title={ws ? `在当前工作区新建会话：${ws}` : "新建会话"}
          onClick={newTask}
        >
          <Plus size={16} /> 新任务
        </button>
      </div>
      <div className="px-3 pt-2">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg2 px-2.5 py-1.5">
          <Search size={13} className="flex-none text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-ghost"
          />
        </div>
      </div>

      {/* session list: projects (workspace-bound) vs free tasks */}
      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {resident && (
          <SessionRowView row={resident} active={location.pathname === `/session/${resident.sessionId}`} pinned onOpen={() => navigate(`/session/${resident.sessionId}`)} onChanged={sessions.retry} />
        )}

        {GROUP_ORDER.map((g) => {
          const list = (groups.get(g) ?? []).filter(match)
          if (!list.length) return null
          return (
            <div key={g} className="mt-2">
              <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-ghost">{g}</div>
              {list.map((r) => (
                <SessionRowView key={r.sessionId} row={r} active={location.pathname === `/session/${r.sessionId}`} onOpen={() => navigate(`/session/${r.sessionId}`)} onChanged={sessions.retry} />
              ))}
            </div>
          )
        })}

        {!q && archived.length > 0 && (
          <div className="mt-2">
            <button
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium uppercase tracking-wide text-ghost hover:text-dim"
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive size={12} /> 归档（{archived.length}）
            </button>
            {showArchived &&
              archived.map((r) => (
                <SessionRowView key={r.sessionId} row={r} active={location.pathname === `/session/${r.sessionId}`} archived onOpen={() => navigate(`/session/${r.sessionId}`)} onChanged={sessions.retry} />
              ))}
          </div>
        )}

        {/* 任务 — free-floating, not tied to a project */}
        {freeTasks.filter(match).length > 0 && (
          <div className="mt-3">
            <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-ghost">任务</div>
            {freeTasks.filter(match).map((r) => (
              <FreeTaskRow key={r.sessionId} row={r} active={location.pathname === `/session/${r.sessionId}`} onOpen={() => navigate(`/session/${r.sessionId}`)} />
            ))}
          </div>
        )}

        {/* honest empty state: a workspace with no sessions must not render a blank list */}
        {!q && sessions.data && !resident && groups.size === 0 && archived.length === 0 && freeTasks.length === 0 && (
          <div className="mt-8 px-4 text-center text-2xs leading-relaxed text-ghost">
            该工作区还没有会话
            <br />
            点上方「新任务」创建
          </div>
        )}
      </nav>

      {/* footer: settings is the hub for usage/schedules/dags/skills/memory/status */}
      <div className="border-t border-line px-2 py-2">
        <Link
          to="/settings"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-dim transition-colors hover:bg-hover hover:text-fg"
        >
          <SettingsIcon size={15} className="flex-none text-faint" />
          <span className="text-xs">设置</span>
        </Link>
        <button
          onClick={onOpenRemote}
          className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-dim transition-colors hover:bg-hover hover:text-fg"
          title="手机/其他设备扫码或复制链接远程访问"
        >
          <QrCode size={15} className="flex-none text-faint" />
          <span className="text-xs">手机 / 远程访问</span>
        </button>
        <button
          className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-dim transition-colors hover:bg-hover hover:text-fg"
          title={theme === "dark" ? "切换到浅色" : "切换到深色"}
          onClick={toggle}
        >
          <SunMoon size={15} className="flex-none text-faint" />
          <span className="text-xs">{theme === "dark" ? "浅色主题" : "深色主题"}</span>
        </button>
      </div>
    </aside>
  )
}

function FreeTaskRow({ row, active, onOpen }: { row: SessionRow; active: boolean; onOpen: () => void }): React.ReactElement {
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover"
      style={active ? { background: "var(--hover-2)" } : undefined}
    >
      <Clock size={14} className="mt-0.5 flex-none text-ghost" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-dim group-hover:text-fg" style={active ? { color: "var(--txt)" } : undefined}>
          {sessionDisplayName(row, "未命名任务")}
        </span>
        <span className="mt-0.5 block text-2xs text-ghost">{relativeTime(row.updatedAt)}</span>
      </span>
    </button>
  )
}

function SessionRowView({
  row,
  active,
  pinned,
  archived,
  onOpen,
  onChanged,
}: {
  row: SessionRow
  active: boolean
  pinned?: boolean
  archived?: boolean
  onOpen: () => void
  /** Refetch the session list after a rename/archive/delete. */
  onChanged?: () => void
}): React.ReactElement {
  const isButler = row.role === "butler"
  const navigate = useNavigate()
  const location = useLocation()
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draftTitle, setDraftTitle] = useState(row.title ?? "")

  const commitRename = (): void => {
    const t = draftTitle.trim()
    if (t && t !== row.title) void api.setTitle(row.sessionId, t)
    setRenaming(false)
    onChanged?.()
  }
  const doArchive = (): void => {
    if (row.archived) void api.unarchiveSession(row.sessionId)
    else void api.archiveSession(row.sessionId)
    onChanged?.()
  }
  const doDelete = (): void => {
    // Refetch AFTER the delete lands — a synchronous refetch races the DELETE
    // and can repaint the just-deleted row until the next poll.
    void api.deleteSession(row.sessionId).then(() => onChanged?.())
    if (location.pathname === `/session/${row.sessionId}`) navigate("/")
  }

  return (
    <div className="group relative mt-0.5">
      <button
        onClick={onOpen}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
        style={active ? { background: "var(--hover-2)" } : undefined}
      >
        {isButler ? (
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center">
            <EmotionBall mood={row.status === "active" ? "thinking" : "idle"} size={22} lite />
          </span>
        ) : (
          <StatusDot status={row.status} className="mt-1.5" />
        )}
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-1.5 truncate text-[13px] ${pinned ? "font-medium text-fg" : "text-dim group-hover:text-fg"}`} style={active ? { color: "var(--txt)" } : undefined}>
            {sessionDisplayName(row)}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-ghost">
            {archived ? <Archive size={10} /> : null}
            <span className="truncate">{isButler ? "常驻会话 · " : ""}{relativeTime(row.updatedAt)}</span>
          </span>
        </span>
      </button>
      {/* Session actions (engine-backed: POST title / POST archive / DELETE).
          The resident session cannot be archived or deleted — it is
          workspace-permanent by design. */}
      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100">
        <Dropdown
          width={180}
          trigger={
            <button
              className="icon-btn !h-6 !w-6 border border-line bg-bg2"
              title="会话操作"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelete(false)
              }}
            >
              <Ellipsis size={13} />
            </button>
          }
        >
          {(close) => (
            <>
              {renaming ? (
                <div className="px-2 py-1.5">
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename()
                      if (e.key === "Escape") setRenaming(false)
                    }}
                    className="input !py-1 text-xs"
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    <button className="btn btn-primary !py-0.5 text-2xs" onClick={commitRename}>保存</button>
                    <button className="btn !py-0.5 text-2xs" onClick={() => setRenaming(false)}>取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <MenuItem
                    icon={<PencilLine size={14} />}
                    onClick={() => {
                      setDraftTitle(row.title ?? "")
                      setRenaming(true)
                    }}
                  >
                    重命名
                  </MenuItem>
                  <MenuItem icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} onClick={doArchive}>
                    {archived ? "取消归档" : "归档"}
                  </MenuItem>
                  {!isButler && (
                    <>
                      <div className="menu-sep" />
                      {confirmDelete ? (
                        <MenuItem icon={<Trash2 size={14} />} onClick={doDelete}>
                          <span className="text-[13px] text-bad">确认删除（不可撤销）</span>
                        </MenuItem>
                      ) : (
                        <MenuItem icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
                          <span className="text-[13px]">删除…</span>
                        </MenuItem>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </Dropdown>
      </div>
    </div>
  )
}

/** Collapsed rail: icon-only strip for maximum workspace width. */
function CollapsedRail({ onExpand, onHome, onSettings, onOpenRemote }: { onExpand?: () => void; onHome?: () => void; onSettings?: () => void; onOpenRemote?: () => void }): React.ReactElement {
  const theme = useTheme()
  return (
    <aside className="flex h-full w-[60px] flex-none flex-col items-center gap-1 border-r border-line bg-side py-3">
      <button className="icon-btn !h-10 !w-10" title="展开侧栏" onClick={onExpand}>
        <PanelLeftOpen size={18} />
      </button>
      <button className="icon-btn !h-10 !w-10" title="新任务 / 封面" onClick={onHome}>
        <Plus size={18} />
      </button>
      <div className="mt-1 flex flex-1 flex-col items-center gap-1">
        <EmotionBall mood="idle" size={34} lite />
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <button className="icon-btn !h-10 !w-10" title="设置" onClick={onSettings}>
          <SettingsIcon size={17} />
        </button>
        <button className="icon-btn !h-10 !w-10" title="手机 / 远程访问" onClick={onOpenRemote}>
          <QrCode size={17} />
        </button>
        <button className="icon-btn !h-10 !w-10" title={theme.theme === "dark" ? "切换到浅色" : "切换到深色"} onClick={theme.toggle}>
          <SunMoon size={17} />
        </button>
      </div>
    </aside>
  )
}
