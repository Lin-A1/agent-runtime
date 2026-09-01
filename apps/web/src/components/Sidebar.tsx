/**
 * Left sidebar — workspace identity block up top, the resident newhorse
 * session pinned beneath it (mini-ball avatar), sessions in timeline groups
 * (今天/昨天/本周/上周/本月/更早) with status dots, an archived group, and
 * a usage/settings footer. Mirrors ZCode's workspaceSidebar density.
 */
import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  Archive,
  Check,
  ChevronsUpDown,
  Clock,
  FolderGit2,
  HardDrive,
  PanelLeftOpen,
  Plus,
  QrCode,
  Search,
  Settings as SettingsIcon,
  SunMoon,
} from "lucide-react"
import { api } from "../api/client"
import type { SessionRow } from "../api/types"
import { prettyTitle, relativeTime } from "../api/fold"
import { WS_NH, WORKSPACES } from "../fixtures/sessions"
import { useApi } from "../lib/useApi"
import { EmotionBall } from "./EmotionBall"
import { Dropdown, MenuItem, Spinner, StatusDot } from "./ui"
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
  const sessions = useApi<SessionRow[]>(() => api.sessions(WS_NH), [])
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)

  const { resident, groups, archived, freeTasks } = useMemo(() => {
    const rows = sessions.data ?? []
    // Free tasks = not bound to any project workspace (项目 vs 任务 split).
    const projectRows = rows.filter((r) => r.workspace && r.workspace !== "")
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
  }, [sessions.data])

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
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">newhorse</span>
              <ChevronsUpDown size={14} className="flex-none text-ghost" />
            </button>
          }
        >
          {(close) => (
            <>
              <div className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-ghost">当前工作区</div>
              <div className="mx-1 mb-1 rounded-md bg-bg2 px-2 py-1.5">
                <div className="truncate font-mono text-2xs text-faint">G:\Code\Agents\Custom\newhorse</div>
              </div>
              <div className="px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wide text-ghost">切换工作区</div>
              {WORKSPACES.map((w) => (
                <MenuItem
                  key={w.path}
                  icon={w.name === "newhorse" ? <Check size={14} className="text-fg" /> : <span className="w-[14px]" />}
                  onClick={() => close()}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{w.name}</span>
                    <span className="block truncate font-mono text-2xs text-ghost">{w.path}</span>
                  </span>
                </MenuItem>
              ))}
              <div className="menu-sep" />
              <MenuItem icon={<Plus size={14} />} onClick={close}>
                打开文件夹…
              </MenuItem>
              <MenuItem icon={<HardDrive size={14} />} onClick={close}>
                从空目录开始
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>

      {/* new task + search */}
      <div className="flex items-center gap-1.5 px-3 pt-3">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-dim transition-colors hover:bg-hover hover:text-fg"
          onClick={() => navigate("/")}
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
          <SessionRowView row={resident} active={location.pathname === `/session/${resident.sessionId}`} pinned onOpen={() => navigate(`/session/${resident.sessionId}`)} />
        )}

        {GROUP_ORDER.map((g) => {
          const list = (groups.get(g) ?? []).filter(match)
          if (!list.length) return null
          return (
            <div key={g} className="mt-2">
              <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-ghost">{g}</div>
              {list.map((r) => (
                <SessionRowView key={r.sessionId} row={r} active={location.pathname === `/session/${r.sessionId}`} onOpen={() => navigate(`/session/${r.sessionId}`)} />
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
                <SessionRowView key={r.sessionId} row={r} active={location.pathname === `/session/${r.sessionId}`} archived onOpen={() => navigate(`/session/${r.sessionId}`)} />
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
          {prettyTitle(row.title, "未命名任务")}
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
}: {
  row: SessionRow
  active: boolean
  pinned?: boolean
  archived?: boolean
  onOpen: () => void
}): React.ReactElement {
  const isButler = row.role === "butler"
  return (
    <button
      onClick={onOpen}
      className="group relative mt-0.5 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
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
          {prettyTitle(row.title, isButler ? "newhorse" : "未命名会话")}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-ghost">
          {archived ? <Archive size={10} /> : null}
          <span className="truncate">{isButler ? "常驻会话 · " : ""}{relativeTime(row.updatedAt)}</span>
        </span>
      </span>
    </button>
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
