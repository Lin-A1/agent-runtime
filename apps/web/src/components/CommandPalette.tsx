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
import { Modal } from "./ui"
import { useApi } from "../lib/useApi"

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [open])
  const commands = useApi<{ commands: CommandInfo[] }>(() => api.commands(), [open])

  useEffect(() => {
    if (open) setQ("")
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

  const go = (to?: string): void => {
    if (to) navigate(to)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="" width={620}>
      <div className="-mt-2 flex items-center gap-2.5 border-b border-line pb-3">
        <Search size={16} className="text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索操作、任务、命令…"
          className="w-full bg-transparent text-base text-fg outline-none placeholder:text-ghost"
        />
        <span className="kbd">ESC</span>
      </div>

      <div className="max-h-[52vh] overflow-y-auto pt-2">
        {match("设置 用量 定时 编排 记忆 运行时") && (
          <Section title="操作">
            {actions
              .filter((a) => match(a.label))
              .map((a) => (
                <Row key={a.label} icon={a.icon} label={a.label} onPick={() => go(a.to)} />
              ))}
          </Section>
        )}

        {sessions.data && (
          <Section title="任务">
            {sessions.data
              .filter((s) => match(prettyTitle(s.title, s.sessionId)))
              .slice(0, 6)
              .map((s) => (
                <Row
                  key={s.sessionId}
                  icon={<Zap size={14} className={s.role === "butler" ? "text-trajassistant" : "text-faint"} />}
                  label={prettyTitle(s.title, s.role === "butler" ? "newhorse 会话" : "未命名会话")}
                  hint={s.role === "butler" ? "常驻会话" : s.model}
                  onPick={() => go(`/session/${s.sessionId}`)}
                />
              ))}
          </Section>
        )}

        {commands.data && (
          <Section title="斜杠命令">
            {commands.data.commands
              .filter((c) => match(`/${c.name} ${c.description ?? ""}`))
              .slice(0, 5)
              .map((c) => (
                <Row key={c.name} icon={<CornerDownLeft size={14} className="text-faint" />} label={`/${c.name}`} hint={c.description} onPick={onClose} />
              ))}
          </Section>
        )}
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement | null {
  const has = Array.isArray(children) ? children.some(Boolean) : Boolean(children)
  if (!has) return null
  return (
    <div className="mb-2">
      <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-faint">{title}</div>
      {children}
    </div>
  )
}

function Row({ icon, label, hint, onPick }: { icon: React.ReactNode; label: string; hint?: string; onPick: () => void }): React.ReactElement {
  return (
    <button onClick={onPick} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-dim hover:bg-hover hover:text-fg">
      <span className="flex-none">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="truncate font-mono text-2xs text-faint">{hint}</span>}
    </button>
  )
}
