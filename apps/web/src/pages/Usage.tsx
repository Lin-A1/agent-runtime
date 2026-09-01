/**
 * Usage — stat cards, a 30-day heatmap (daily/weekly/cumulative range),
 * session ranking (click → session), per-model split folded from byModel
 * (§1.5④), and the model-call trace table (Session.ModelCalled metadata,
 * #38 — metadata only, no payload capture).
 */
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Activity, Coins, Cpu, Footprints, TrendingUp } from "lucide-react"
import { api } from "../api/client"
import type { UsageSummary } from "../api/types"
import { relativeTime } from "../api/fold"
import { useApi } from "../lib/useApi"
import { AsyncRegion, EmptyState, PageHeader, Segmented, Spinner } from "../components/ui"

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function UsagePage(): React.ReactElement {
  const [range, setRange] = useState<"daily" | "weekly" | "cumulative">("daily")
  const usage = useApi<UsageSummary>(() => api.usage(30), [])
  const navigate = useNavigate()

  const modelSplit = useMemo(() => {
    const acc = new Map<string, { in: number; out: number }>()
    for (const d of usage.data?.days ?? []) {
      for (const [m, v] of Object.entries(d.byModel ?? {})) {
        const cur = acc.get(m) ?? { in: 0, out: 0 }
        cur.in += v.inputTokens
        cur.out += v.outputTokens
        acc.set(m, cur)
      }
    }
    return [...acc.entries()].sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out))
  }, [usage.data])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="用量分析" backTo="/settings"
        sub="按天聚合自事件日志（Session.ModelCalled）；成本按当前供应商计价估算。"
        actions={
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "daily", label: "每日" },
              { value: "weekly", label: "每周" },
              { value: "cumulative", label: "累计" },
            ]}
          />
        }
      />
      <AsyncRegion
        state={usage}
        emptyIf={(u) => u.days.length === 0}
        empty={<EmptyState className="!py-24" icon={<Activity size={18} />} title="近 30 天没有用量" hint="发起一次对话后，token 与成本会在这里按天聚合。" />}
      >
        {(u) => (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={<TrendingUp size={15} />} label="总 tokens" value={fmtTokens(u.totals.inputTokens + u.totals.outputTokens)} sub={`输入 ${fmtTokens(u.totals.inputTokens)} · 输出 ${fmtTokens(u.totals.outputTokens)}`} />
              <StatCard icon={<Coins size={15} />} label="估算成本" value={`¥${u.totals.cost.toFixed(2)}`} sub="按供应商单价折算" />
              <StatCard icon={<Footprints size={15} />} label="工具步数" value={String(u.totals.steps)} sub={`${u.sessions} 个会话`} />
              <StatCard icon={<Cpu size={15} />} label="缓存读取" value={fmtTokens(u.totals.cacheReadTokens ?? 0)} sub="prefix cache 命中" />
            </div>

            {/* heatmap */}
            <section className="card mt-5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-fg">活动热力（近 30 天）</h2>
                <HeatLegend />
              </div>
              <Heatmap days={u.days} />
              <p className="mt-2 text-2xs text-faint">{peakSummary(u)}</p>
            </section>

            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              {/* session ranking */}
              <section className="card overflow-hidden">
                <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-fg">会话排行</h2>
                <div>
                  {(u.sessionRows ?? []).map((r, i) => (
                    <button key={r.sessionId} onClick={() => navigate(`/session/${r.sessionId}`)} className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-b-0 hover:bg-hover">
                      <span className="w-4 flex-none text-center font-mono text-2xs text-ghost">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-2xs text-fg">{r.sessionId}</span>
                        <span className="block text-2xs text-faint">{relativeTime(r.lastActivity)}</span>
                      </span>
                      {r.model && <span className="hidden flex-none font-mono text-2xs text-faint md:block">{r.model}</span>}
                      <span className="flex-none font-mono text-2xs text-dim">{fmtTokens(r.inputTokens + r.outputTokens)}</span>
                      <span className="flex-none font-mono text-2xs text-faint">¥{r.cost.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* model split + trace */}
              <section className="card overflow-hidden">
                <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-fg">按模型分列</h2>
                <div className="p-4">
                  {modelSplit.map(([m, v]) => {
                    const total = modelSplit.reduce((s, [, x]) => s + x.in + x.out, 0)
                    const ratio = (v.in + v.out) / total
                    return (
                      <div key={m} className="mb-2.5">
                        <div className="flex items-center justify-between font-mono text-2xs">
                          <span className="text-dim">{m}</span>
                          <span className="text-faint">{fmtTokens(v.in + v.out)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg2">
                          <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: "var(--txt-dim)" }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <h2 className="border-t border-line px-4 py-2.5 text-sm font-semibold text-fg">模型调用轨迹（元数据）</h2>
                <div className="p-4 pt-2">
                  <TraceRows />
                </div>
              </section>
            </div>
          </div>
        )}
      </AsyncRegion>
      {usage.loading && <div className="p-10"><Spinner /></div>}
    </div>
  )
}

function TraceRows(): React.ReactElement {
  const events = useApi(() => api.events("sess-nh-butler"), [])
  const calls = useMemo(
    () => (events.data ?? []).filter((e) => e.type === "Session.ModelCalled").slice(-6).reverse(),
    [events.data],
  )
  if (events.loading) return <Spinner size={13} />
  return (
    <div className="space-y-1.5">
      {calls.length === 0 && <p className="text-2xs text-faint">暂无调用记录</p>}
      {calls.map((e) => {
        const d = e.data as { source?: string; model?: string; durationMs?: number; finish?: string; error?: string }
        return (
          <div key={e.seq} className="flex items-center gap-2 font-mono text-2xs">
            <span className={`chip !py-0 !text-[10px] ${d.source === "compaction" ? "" : ""}`}>{d.source}</span>
            <span className="flex-1 truncate text-dim">{d.model}</span>
            {d.durationMs && <span className="text-faint">{(d.durationMs / 1000).toFixed(1)}s</span>}
            {d.error ? <span className="text-bad">error</span> : <span className="text-faint">{d.finish ?? "—"}</span>}
          </div>
        )
      })}
    </div>
  )
}

function peakSummary(u: UsageSummary): string {
  let peak = u.days[0]
  for (const d of u.days) if (d.inputTokens + d.outputTokens > (peak?.inputTokens ?? 0) + (peak?.outputTokens ?? 0)) peak = d
  if (!peak) return ""
  return `最活跃日期是 ${peak.day}，约 ${fmtTokens(peak.inputTokens + peak.outputTokens)} tokens。`
}

function Heatmap({ days }: { days: UsageSummary["days"] }): React.ReactElement {
  const max = Math.max(1, ...days.map((d) => d.inputTokens + d.outputTokens))
  return (
    <div className="flex flex-wrap gap-[3px]">
      {days.map((d) => {
        const v = d.inputTokens + d.outputTokens
        const level = v === 0 ? 0 : v / max > 0.75 ? 4 : v / max > 0.5 ? 3 : v / max > 0.25 ? 2 : 1
        const bg = ["var(--bg2)", "rgba(148,158,178,0.22)", "rgba(148,158,178,0.42)", "rgba(148,158,178,0.68)", "var(--txt-dim)"][level]
        return (
          <div
            key={d.day}
            title={`${d.day} · ${fmtTokens(v)} tokens · ¥${d.cost.toFixed(2)}`}
            className="h-[26px] w-[26px] rounded-[4px]"
            style={{ background: bg }}
          />
        )
      })}
    </div>
  )
}

function HeatLegend(): React.ReactElement {
  return (
    <div className="flex items-center gap-1 text-2xs text-faint">
      少
      {["var(--bg2)", "rgba(148,158,178,0.22)", "rgba(148,158,178,0.42)", "rgba(148,158,178,0.68)", "var(--txt-dim)"].map((c) => (
        <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
      ))}
      多
    </div>
  )
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }): React.ReactElement {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-faint">
        {icon}
        <span className="text-2xs">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-fg">{value}</div>
      <div className="mt-0.5 text-2xs text-faint">{sub}</div>
    </div>
  )
}
