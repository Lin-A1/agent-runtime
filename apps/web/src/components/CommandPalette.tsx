/**
 * Ctrl+K command center — ZCode commandCenter structure (scopes: 操作 /
 * 任务 / 命令 / 文件). Shell data comes from the same fixtures; selecting a
 * task/file navigates. No fake actions: every row goes somewhere real.
 */
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BarChart3, CalendarClock, CornerDownLeft, GitBranch, Inbox, Network, Search, Settings as SettingsIcon, Square, Zap } from "lucide-react"
import { api } from "../api/client"
import type { CommandInfo, SessionRow } from "../api/types"
import { prettyTitle } from "../api/fold"
import { useLocation } from "react-router-dom"
import { Modal } from "./ui"
import { useApi } from "../lib/useApi"

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [open])
  const commands = useApi<{ commands: CommandInfo[] }>(() => api.commands(), [open])
  // 中断当前回合 targets the session you are actually looking at.
  const routeSession =
    /^\/session\/(.+)$/.exec(location.pathname)?.[1] ??
    (sessions.data ?? []).find((r) => r.role === "butler")?.sessionId ??
    ""

  useEffect(() => {
    if (open) {
      setQ("")
      setCursor(0)
    }
  }, [open])

  const actions = useMemo(
    () => [
      { icon: <SettingsIcon size={14} />, label: "打开设置", to: "/settings" },
      { icon: <BarChart3 size={14} />, label: "用量分析", to: "/usage" },
      { icon: <CalendarClock size={14} />, label: "定时任务", to: "/schedules" },
      { icon: <GitBranch size={14} />, label: "编排（DAG）", to: "/dags" },
      { icon: <Inbox size={14} />, label: "记忆", to: "/memory" },
      { icon: <Network size={14} />, label: "运行时目录", to: "/live" },
      { icon: <Square size={14} />, label: "中断当前回合", to: undefined, action: "interrupt" },
    ],
    [],
  )

  const query = q.trim().toLowerCase()
  const match = (s: string): boolean => !query || s.toLowerCase().includes(query)

  // Flattened pickables in visual order — drives ArrowUp/Down + Enter. A
  // slash command inserts into the active composer via a custom-event
  // bridge (the composer listens for nh-composer-insert).
  type PickItem = { key: string; section: string; icon: React.ReactNode; label: string; hint?: string; pick: () => void }
  const flat = useMemo<PickItem[]>(() => {
    const items: PickItem[] = []
    for (const a of actions) {
      if (!match(a.label)) continue
      items.push({
        key: "act:" + a.label,
        section: "操作",
        icon: a.icon,
        label: a.label,
        pick: () => {
          if (a.action === "interrupt") {
            if (routeSession) void api.interrupt(routeSession)
          } else if (a.to) {
            navigate(a.to)
          }
          onClose()
        },
      })
    }
    for (const s of sessions.data ?? []) {
      const label = prettyTitle(s.title, s.role === "butler" ? "newhorse 会话" : "未命名会话")
      if (!match(label) && !match(s.sessionId)) continue
      items.push({
        key: "sess:" + s.sessionId,
        section: "任务",
        icon: <Zap size={14} className={s.role === "butler" ? "text-trajassistant" : "text-faint"} />,
        label,
        hint: s.role === "butler" ? "常驻会话" : s.model,
        pick: () => {
          navigate(`/session/${s.sessionId}`)
          onClose()
        },
      })
    }
    for (const c of commands.data?.commands ?? []) {
      if (!match(`/${c.name} ${c.description ?? ""}`)) continue
      items.push({
        key: "cmd:" + c.name,
        section: "斜杠命令",
        icon: <CornerDownLeft size={14} className="text-faint" />,
        label: `/${c.name}`,
        hint: c.description,
        pick: () => {
          window.dispatchEvent(new CustomEvent("nh-composer-insert", { detail: `/${c.name} ` }))
          onClose()
        },
      })
    }
    return items
  }, [actions, sessions.data, commands.data, query])
  const flatCount = flat.length
  const cursorIdx = Math.min(cursor, Math.max(0, flatCount - 1))
  const cursorItem = flat[cursorIdx]

  return (
    <Modal open={open} onClose={onClose} title="命令面板" width={620}>
      <div className="-mt-2 flex items-center gap-2.5 border-b border-line pb-3">
        <Search size={16} className="text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setCursor(0)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, Math.max(0, flatCount - 1)))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === "Enter") {
              e.preventDefault()
              cursorItem?.pick()
            }
          }}
          placeholder="搜索操作、任务、命令…"
          className="w-full bg-transparent text-base text-fg outline-none placeholder:text-ghost"
        />
        <span className="kbd">ESC</span>
      </div>

      {/* Follow the keyboard cursor: keep the highlighted row in view. */}
      <PaletteScroller cursorKey={cursorItem?.key ?? ""} />
      <div className="max-h-[52vh] overflow-y-auto pt-2">
        {flat.length === 0 && <div className="px-3 py-6 text-center text-xs text-ghost">没有匹配的结果</div>}
        {flat.map((item, idx) => {
          const prev = idx > 0 ? flat[idx - 1] : undefined
          const showSection = !prev || prev.section !== item.section
          const active = idx === cursorIdx
          return (
            <div key={item.key}>
              {showSection && <div className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-faint">{item.section}</div>}
              <button
                data-cursor={active ? "true" : undefined}
                onClick={item.pick}
                onMouseEnter={() => setCursor(idx)}
                className={"flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors " + (active ? "bg-hover text-fg" : "text-dim hover:bg-hover hover:text-fg")}
              >
                <span className="flex-none">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="truncate font-mono text-2xs text-faint">{item.hint}</span>}
              </button>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

/** Keeps the keyboard-highlighted row inside the scroll viewport. Lives
 *  outside the scroll container so it can query the highlighted row. */
function PaletteScroller({ cursorKey }: { cursorKey: string }): React.ReactElement {
  useEffect(() => {
    document.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" })
  }, [cursorKey])
  return null as unknown as React.ReactElement
}
