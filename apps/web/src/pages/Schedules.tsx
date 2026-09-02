/**
 * Schedules — timed prompts over hard-coded fixtures with live local
 * interaction: enable toggle, run-now (updates last result/time), two-step
 * delete, and create all mutate local state. Wiring day swaps to /v1/schedules.
 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarClock, Play, Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react"
import { api } from "../api/client"
import type { Schedule, SessionRow } from "../api/types"
import { prettyTitle, relativeTime } from "../api/fold"
import { EmptyState, Modal, PageHeader, Toggle } from "../components/ui"
import { useApi } from "../lib/useApi"
import { ensureResidentSession } from "../api/client"

function cadence(s: Schedule): string {
  if (s.intervalMinutes) return s.intervalMinutes < 60 ? `每 ${s.intervalMinutes} 分钟` : `每 ${Math.round(s.intervalMinutes / 60)} 小时`
  if (s.dailyAt) return `每天 ${s.dailyAt}`
  if (s.cron) return cronText(s.cron)
  return "—"
}

function cronText(cron: string): string {
  const parts = cron.split(/\s+/)
  const m = parts[0]
  const h = parts[1]
  const dow = parts[4]
  if (dow === "1") return `每周一 ${h}:${m}`
  if (m === "0" && h === "*") return "每小时整点"
  if (dow === "*" && m === "0") return `每天 ${h}:00`
  return `cron: ${cron}`
}

export function SchedulesPage(): React.ReactElement {
  const navigate = useNavigate()
  const [items, setItems] = useState<Schedule[]>([])
  const listState = useApi<Schedule[]>(() => api.schedules(), [])
  useEffect(() => {
    if (listState.data) setItems(listState.data)
  }, [listState.data])
  const sessState = useApi<SessionRow[]>(() => api.sessions(), [])
  const sessList = sessState.data
  const refetch = (): void => {
    void api.schedules().then(setItems).catch(() => {})
  }
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState({ prompt: "", cadenceType: "daily", time: "09:00", sessionId: "" })
  const [createErr, setCreateErr] = useState<string | null>(null)
  useEffect(() => {
    if (createOpen && !draft.sessionId) void ensureResidentSession().then((id) => setDraft((d) => ({ ...d, sessionId: id })))
  }, [createOpen, draft.sessionId])

  const toggle = (id: string): void => {
    const t = items.find((x) => x.id === id)
    setItems((p) => p.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
    if (t) void api.updateSchedule(id, { enabled: !t.enabled })
  }
  const runNow = (id: string): void => {
    setItems((p) => p.map((s) => (s.id === id ? { ...s, lastRunAt: Date.now(), lastResult: "ok", lastError: undefined } : s)))
    void api.runSchedule(id)
  }
  const remove = (id: string): void => {
    void api.removeSchedule(id)
    setItems((p) => p.filter((s) => s.id !== id))
    setConfirmId(null)
  }
  const create = (): void => {
    if (!draft.prompt.trim() || !draft.sessionId) return
    // ScheduleInput 三种节奏：dailyAt（HH:MM）/ intervalMinutes / cron 表达式。
    const body: Record<string, unknown> = {
      sessionId: draft.sessionId,
      prompt: draft.prompt.trim(),
      enabled: true,
    }
    if (draft.cadenceType === "daily") body.dailyAt = draft.time
    else if (draft.cadenceType === "interval") body.intervalMinutes = Math.max(1, Math.floor(Number(draft.time) || 30))
    else body.cron = draft.time
    setCreateErr(null)
    void api.addSchedule(body)
      .then(() => {
        void api.schedules().then(setItems).catch(() => {})
        setDraft({ prompt: "", cadenceType: "daily", time: "09:00", sessionId: "" })
        setCreateOpen(false)
      })
      .catch((e) => setCreateErr(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="定时任务" backTo="/settings"
        sub="服务端 tick 循环驱动；到点把提示词作为用户消息准入目标会话（重启不丢）。"
        actions={
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={13} /> 新建定时
          </button>
        }
      />
      {items.length === 0 ? (
        <EmptyState className="!py-24" icon={<CalendarClock size={18} />} title="还没有定时任务" hint="设定节奏与目标会话，让 newhorse 按时自动开工。" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((s) => (
              <div key={s.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line bg-bg2 ${s.enabled ? "text-dim" : "text-faint"}`}>
                    <CalendarClock size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="chip !py-0 !text-[10px]">{cadence(s)}</span>
                      {s.lastResult === "error" ? (
                        <span className="flex items-center gap-1 text-2xs text-bad">
                          <AlertTriangle size={11} /> 上次失败
                        </span>
                      ) : s.lastResult === "ok" ? (
                        <span className="flex items-center gap-1 text-2xs text-ok">
                          <CheckCircle2 size={11} /> 上次成功
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-fg">{s.prompt}</p>
                    <button onClick={() => navigate(`/session/${s.sessionId}`)} className="mt-2 block truncate text-left font-mono text-2xs text-accent hover:underline">
                      → {s.sessionId}
                    </button>
                    {s.lastResult === "error" && s.lastError && <p className="mt-1.5 rounded-md bg-bg2 p-2 text-2xs leading-relaxed text-bad">{s.lastError}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-line pt-2.5">
                      <button className="flex items-center gap-1.5 text-2xs text-faint" onClick={() => toggle(s.id)}>
                        <Toggle checked={s.enabled} />
                        {s.enabled ? "已启用" : "已停用"}
                      </button>
                      <span className="w-full text-2xs text-ghost md:w-auto">{s.lastRunAt ? `上次运行 ${relativeTime(s.lastRunAt)}` : "尚未运行"}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <button className="btn !py-1 text-2xs" title="立即执行" onClick={() => runNow(s.id)}>
                          <Play size={11} /> 运行
                        </button>
                        {confirmId === s.id ? (
                          <>
                            <button className="btn btn-danger !py-1 text-2xs" onClick={() => remove(s.id)}>
                              <Trash2 size={11} /> 确认删除
                            </button>
                            <button className="btn !py-1 text-2xs" onClick={() => setConfirmId(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button className="icon-btn !h-7 !w-7" title="删除" onClick={() => setConfirmId(s.id)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="新建定时任务">
        <div className="space-y-3">
          <div>
            <label className="label mb-1 block">提示词</label>
            <textarea
              className="input min-h-[80px] resize-y"
              placeholder="到点自动发送给目标会话的任务…"
              value={draft.prompt}
              onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="label mb-1 block">节奏</span>
              <select className="input text-xs" value={draft.cadenceType} onChange={(e) => setDraft((d) => ({ ...d, cadenceType: e.target.value }))}>
                <option value="daily">每天定时</option>
                <option value="interval">间隔分钟</option>
                <option value="cron">cron 表达式</option>
              </select>
            </label>
            <label className="block">
              <span className="label mb-1 block">时间 / 间隔</span>
              <input className="input font-mono text-xs" value={draft.time} onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))} />
            </label>
            <label className="block">
              <span className="label mb-1 block">目标会话</span>
              <select className="input text-xs" value={draft.sessionId} onChange={(e) => setDraft((d) => ({ ...d, sessionId: e.target.value }))}>
                {draft.sessionId === "" && <option value="">选择会话…</option>}
                {(sessList ?? []).map((r) => (
                  <option key={r.sessionId} value={r.sessionId}>{prettyTitle(r.title, r.sessionId, 22)}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {createErr && <p className="mt-2 text-2xs text-bad">{createErr}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setCreateOpen(false)}>
            取消
          </button>
          <button className="btn btn-primary" onClick={create} disabled={!draft.prompt.trim() || !draft.sessionId}>
            创建
          </button>
        </div>
      </Modal>
    </div>
  )
}
