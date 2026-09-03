/**
 * Schedules — live CRUD over /v1/schedules: create, edit (PATCH changed
 * fields only), enable toggle, run-now, two-step delete. 下次触发时间不在
 * API 里，由 nextFireAt 在客户端按 intervalMinutes/dailyAt/cron 推算（cron
 * 只认 `*` 与纯数字，复杂表达式回退展示原文）。
 */
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarClock, Play, Plus, Pencil, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react"
import { api, ensureResidentSession } from "../api/client"
import type { Schedule, SessionRow } from "../api/types"
import { relativeTime, sessionDisplayName } from "../api/fold"
import { EmptyState, Modal, PageHeader, Toggle } from "../components/ui"
import { useApi } from "../lib/useApi"

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

/** 简单 cron（仅 `*` 或纯数字字段）的下一触发时刻；复杂表达式返回 undefined。 */
function nextCron(cron: string, now: number): number | undefined {
  const fields = cron.split(/\s+/)
  if (fields.length !== 5) return undefined
  const maxes = [59, 23, 31, 12, 6]
  const vals: (number | null)[] = []
  for (let i = 0; i < 5; i++) {
    const f = fields[i]!
    if (f === "*") {
      vals.push(null)
      continue
    }
    if (!/^\d+$/.test(f)) return undefined
    const n = i === 4 && Number(f) === 7 ? 0 : Number(f)
    if (n > maxes[i]!) return undefined
    vals.push(n)
  }
  const cursor = new Date(now)
  cursor.setSeconds(0, 0)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1)
    if (vals[0] !== null && cursor.getMinutes() !== vals[0]) continue
    if (vals[1] !== null && cursor.getHours() !== vals[1]) continue
    if (vals[2] !== null && cursor.getDate() !== vals[2]) continue
    if (vals[3] !== null && cursor.getMonth() + 1 !== vals[3]) continue
    if (vals[4] !== null && cursor.getDay() !== vals[4]) continue
    return cursor.getTime()
  }
  return undefined
}

/** 下次触发（客户端推算，与引擎 nextDue 同语义）：interval 从 lastRunAt ?? createdAt 步进。 */
function nextFireAt(s: Schedule, now: number): number | undefined {
  if (s.intervalMinutes && s.intervalMinutes > 0) {
    const step = s.intervalMinutes * 60_000
    const base = s.lastRunAt ?? s.createdAt
    if (base + step > now) return base + step
    return base + (Math.floor((now - base) / step) + 1) * step
  }
  if (s.dailyAt) {
    const [h, m] = s.dailyAt.split(":").map(Number)
    if (!Number.isInteger(h) || !Number.isInteger(m) || h! < 0 || h! > 23 || m! < 0 || m! > 59) return undefined
    const d = new Date(now)
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0)
    if (next.getTime() <= now) next.setDate(next.getDate() + 1)
    return next.getTime()
  }
  if (s.cron) return nextCron(s.cron, now)
  return undefined
}

/** 未来时间的简短中文表述（relativeTime 只面向过去）。 */
function futureTime(ts: number, now: number): string {
  const diff = ts - now
  if (diff < 60_000) return "1 分钟内"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟后`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时后`
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

interface Draft {
  prompt: string
  cadenceType: "daily" | "interval" | "cron"
  time: string
  sessionId: string
}

const EMPTY_DRAFT: Draft = { prompt: "", cadenceType: "daily", time: "09:00", sessionId: "" }

function draftFrom(s: Schedule): Draft {
  if (s.dailyAt) return { prompt: s.prompt, cadenceType: "daily", time: s.dailyAt, sessionId: s.sessionId }
  if (s.intervalMinutes) return { prompt: s.prompt, cadenceType: "interval", time: String(s.intervalMinutes), sessionId: s.sessionId }
  return { prompt: s.prompt, cadenceType: "cron", time: s.cron ?? "", sessionId: s.sessionId }
}

/** 新建/编辑共用的表单体。 */
function ScheduleForm({ draft, setDraft, sessList }: { draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; sessList: SessionRow[] }): React.ReactElement {
  return (
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
          <select className="input text-xs" value={draft.cadenceType} onChange={(e) => setDraft((d) => ({ ...d, cadenceType: e.target.value as Draft["cadenceType"] }))}>
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
            {sessList.map((r) => (
              <option key={r.sessionId} value={r.sessionId}>{sessionDisplayName(r, r.sessionId, 22)}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

export function SchedulesPage(): React.ReactElement {
  const navigate = useNavigate()
  const [items, setItems] = useState<Schedule[]>([])
  const listState = useApi<Schedule[]>(() => api.schedules(), [])
  useEffect(() => {
    if (listState.data) setItems(listState.data)
  }, [listState.data])
  const sessState = useApi<SessionRow[]>(() => api.sessions(), [])
  const sessList = sessState.data ?? []
  const refetch = (): void => {
    void api.schedules().then(setItems).catch(() => {})
  }
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editErr, setEditErr] = useState<string | null>(null)
  // 下次触发倒计时每 30s 重算一次。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (createOpen && !draft.sessionId) void ensureResidentSession().then((id) => setDraft((d) => ({ ...d, sessionId: id })))
  }, [createOpen, draft.sessionId])

  const nextFires = useMemo(() => new Map(items.map((s) => [s.id, nextFireAt(s, now)])), [items, now])

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
  const openEdit = (s: Schedule): void => {
    setEditing(s)
    setEditDraft(draftFrom(s))
    setEditErr(null)
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
    if (draft.cadenceType === "interval") body.intervalMinutes = Math.max(1, Math.floor(Number(draft.time) || 30))
    if (draft.cadenceType === "cron") body.cron = draft.time
    setCreateErr(null)
    void api.addSchedule(body)
      .then(() => {
        refetch()
        setDraft(EMPTY_DRAFT)
        setCreateOpen(false)
      })
      .catch((e) => setCreateErr(e instanceof Error ? e.message : String(e)))
  }
  const saveEdit = (): void => {
    const s = editing
    if (!s) return
    // 只 PATCH 变更字段。注意：引擎 update 是合并语义且要求三种节奏恰好其一，
    // 跨类型改节奏（如 每天→间隔）无法清掉旧字段，会被引擎拒绝——错误直接展示。
    const patch: Record<string, unknown> = {}
    if (editDraft.prompt.trim() && editDraft.prompt.trim() !== s.prompt) patch.prompt = editDraft.prompt.trim()
    if (editDraft.sessionId && editDraft.sessionId !== s.sessionId) patch.sessionId = editDraft.sessionId
    if (editDraft.cadenceType === "daily" && editDraft.time !== s.dailyAt) patch.dailyAt = editDraft.time
    if (editDraft.cadenceType === "interval") {
      const v = Math.max(1, Math.floor(Number(editDraft.time) || 30))
      if (v !== s.intervalMinutes) patch.intervalMinutes = v
    }
    if (editDraft.cadenceType === "cron" && editDraft.time !== (s.cron ?? "")) patch.cron = editDraft.time
    if (Object.keys(patch).length === 0) {
      setEditing(null)
      return
    }
    setEditErr(null)
    void api.updateSchedule(s.id, patch)
      .then(() => {
        setEditing(null)
        refetch()
      })
      .catch((e) => setEditErr(e instanceof Error ? e.message : String(e)))
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
            {items.map((s) => {
              const next = nextFires.get(s.id)
              return (
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
                        <span className="w-full text-2xs text-ghost md:w-auto">
                          {s.lastRunAt ? `上次运行 ${relativeTime(s.lastRunAt)}` : "尚未运行"}
                          {s.enabled && next !== undefined && ` · 下次 ${futureTime(next, now)}`}
                          {s.enabled && next === undefined && s.cron && ` · 下次触发见 ${s.cron}`}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <button className="icon-btn !h-7 !w-7" title="编辑" onClick={() => openEdit(s)}>
                            <Pencil size={13} />
                          </button>
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
              )
            })}
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="新建定时任务">
        <ScheduleForm draft={draft} setDraft={setDraft} sessList={sessList} />
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="编辑定时任务">
        <ScheduleForm draft={editDraft} setDraft={setEditDraft} sessList={sessList} />
        <p className="mt-2 text-2xs text-faint">仅提交变更字段；跨节奏类型修改（如 每天→间隔）可能被引擎拒绝。</p>
        {editErr && <p className="mt-2 text-2xs text-bad">{editErr}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setEditing(null)}>
            取消
          </button>
          <button className="btn btn-primary" onClick={saveEdit} disabled={!editDraft.prompt.trim() || !editDraft.sessionId}>
            保存
          </button>
        </div>
      </Modal>
    </div>
  )
}
