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
  BarChart3,
  CalendarClock,
  Check,
  ChevronsUpDown,
  FolderGit2,
  GitBranch,
  HardDrive,
  Inbox,
  Network,
  Plus,
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

export function Sidebar(): React.ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const { toggle, theme } = useTheme()
  const sessions = useApi<SessionRow[]>(() => api.sessions(WS_NH), [])
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)

  const { resident, groups, archived } = useMemo(() => {
    const rows = sessions.data ?? []
    const resident = rows.find((r) => r.role === "butler" && !r.archived)
    const rest = rows.filter((r) => r.role !== "butler")
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
    return { resident, groups, archived }
  }, [sessions.data])

  const q = query.trim().toLowerCase()
  const match = (r: SessionRow): boolean => !q || (r.title ?? "").toLowerCase().includes(q) || r.sessionId.toLowerCase().includes(q)

  return (
    <aside className="flex h-full w-[248px] flex-none flex-col border-r border-line bg-side">
      {/* workspace identity */}
      <div className="px-3 pt-3">
        <Dropdown
          width={280}
          trigger={
            <button className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-panel px-2.5 py-2 text-left hover:border-linestrong">
              <FolderGit2 size={16} className="flex-none text-dim" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">newhorse</span>
                <span className="block truncate font-mono text-2xs text-faint">G:\Code\Agents\Custom\newhorse</span>
              </span>
              <ChevronsUpDown size={14} className="flex-none text-faint" />
            </button>
          }
        >
          {(close) => (
            <>
              <div className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-faint">切换工作区</div>
              {WORKSPACES.map((w) => (
                <MenuItem
                  key={w.path}
                  icon={w.name === "newhorse" ? <Check size={14} className="text-accent" /> : <span className="w-[14px]" />}
                  onClick={() => close()}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{w.name}</span>
                    <span className="block truncate font-mono text-2xs text-faint">{w.path}</span>
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
        <button className="btn btn-primary flex-1 justify-center" onClick={() => navigate("/")}>
          <Plus size={14} /> 新任务
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

      {/* session list */}
      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {sessions.loading && (
          <div className="flex justify-center py-8">
            <Spinner size={15} />
          </div>
        )}
        {resident && (
          <SessionRowView row={resident} active={location.pathname === `/session/${resident.sessionId}`} pinned onOpen={() => navigate(`/session/${resident.sessionId}`)} />
        )}

        {GROUP_ORDER.map((g) => {
          const list = (groups.get(g) ?? []).filter(match)
          if (!list.length) return null
          return (
            <div key={g} className="mt-2">
              <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-faint">{g}</div>
              {list.map((r) => (
                <SessionRowView key={r.sessionId} row={r} active={location.pathname === `/session/${r.sessionId}`} onOpen={() => navigate(`/session/${r.sessionId}`)} />
              ))}
            </div>
          )
        })}

        {!q && archived.length > 0 && (
          <div className="mt-2">
            <button
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium uppercase tracking-wide text-faint hover:text-dim"
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
        {sessions.data && !sessions.loading && groups.size === 0 && !resident && (
          <div className="px-2 py-6 text-center text-2xs text-faint">暂无会话</div>
        )}
      </nav>

      {/* page nav */}
      <div className="border-t border-line px-2 py-2">
        <NavLink to="/usage" icon={<BarChart3 size={14} />} label="用量分析" active={location.pathname === "/usage"} />
        <NavLink to="/schedules" icon={<CalendarClock size={14} />} label="定时任务" active={location.pathname === "/schedules"} />
        <NavLink to="/dags" icon={<GitBranch size={14} />} label="编排" active={location.pathname === "/dags"} />
        <NavLink to="/memory" icon={<Inbox size={14} />} label="记忆" active={location.pathname === "/memory"} />
        <NavLink to="/live" icon={<Network size={14} />} label="运行时目录" active={location.pathname === "/live"} />
      </div>

      {/* footer: usage mini + settings + theme */}
      <div className="border-t border-line p-3">
        <Link to="/usage" className="block rounded-lg border border-line bg-panel px-3 py-2 hover:border-linestrong">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-faint">近 30 天用量</span>
            <BarChart3 size={12} className="text-faint" />
          </div>
          <div className="mt-1 text-sm font-semibold text-fg">4.2M tokens</div>
          <div className="text-2xs text-faint">¥18.6 · 12 个会话</div>
        </Link>
        <div className="mt-2 flex items-center gap-1">
          <Link to="/settings" className="btn flex-1 justify-center">
            <SettingsIcon size={13} /> 设置
          </Link>
          <button className="icon-btn" title={theme === "dark" ? "切换到浅色" : "切换到深色"} onClick={toggle}>
            <SunMoon size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function NavLink({ to, icon, label, active }: { to: string; icon: React.ReactNode; label: string; active: boolean }): React.ReactElement {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-dim hover:bg-hover hover:text-fg"
      style={active ? { background: "var(--hover-2)", color: "var(--txt)" } : undefined}
    >
      {icon}
      {label}
    </Link>
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
        <span className={`flex items-center gap-1.5 truncate text-xs ${pinned ? "font-medium text-fg" : "text-dim group-hover:text-fg"}`} style={active ? { color: "var(--txt)" } : undefined}>
          {prettyTitle(row.title, isButler ? "newhorse 会话" : "未命名会话")}
          {pinned && <span className="chip !py-0 !text-[10px]">常驻</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-faint">
          {archived ? <Archive size={10} /> : null}
          <span className="truncate">{isButler ? "常驻会话 · " : ""}{relativeTime(row.updatedAt)}</span>
          {row.model && <span className="truncate font-mono">· {row.model}</span>}
        </span>
      </span>
    </button>
  )
}
