/**
 * Usage — stat cards over the CURRENT range, a range-aware chart (每日热力 /
 * 每周聚合条 / 累计曲线), top-10 session ranking by cost (click → session),
 * and a per-model split folded from byModel (§1.5④). All ranges derive from
 * the same /v1/usage days[] payload — weekly/cumulative are client-side
 * re-aggregations, not new fetches.
 */
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Activity, Coins, Cpu, Footprints, TrendingUp } from "lucide-react"
import { api } from "../api/client"
import type { UsageDay, UsageSummary } from "../api/types"
import { relativeTime } from "../api/fold"
import { useApi } from "../lib/useApi"
import { AsyncRegion, EmptyState, PageHeader, Segmented } from "../components/ui"

type Range = "daily" | "weekly" | "cumulative"

/** 一个展示桶：每日 = 一天，每周 = 一个 ISO 周，累计 = 到该日为止的累计值。 */
interface Bucket {
  key: string
  label: string
  inputTokens: number
  outputTokens: number
  cost: number
  steps: number
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** ISO 周聚合：以周一日期为 key/标签，token/成本/步数求和。 */
function weeklyBuckets(days: UsageDay[]): Bucket[] {
  const acc = new Map<string, Bucket>()
  for (const d of days) {
    const [y, m, dd] = d.day.split("-").map(Number)
    const date = new Date(y!, (m ?? 1) - 1, dd)
    const monday = new Date(date)
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`
    const cur = acc.get(key) ?? { key, label: `${monday.getMonth() + 1}月${monday.getDate()}日 周`, inputTokens: 0, outputTokens: 0, cost: 0, steps: 0 }
    cur.inputTokens += d.inputTokens
    cur.outputTokens += d.outputTokens
    cur.cost += d.cost
    cur.steps += d.steps
    acc.set(key, cur)
  }
  return [...acc.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** 累计：每个点 = 截至该日的运行求和（单调递增）。 */
function cumulativeBuckets(days: UsageDay[]): Bucket[] {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day))
  let inputTokens = 0
  let outputTokens = 0
  let cost = 0
  let steps = 0
  return sorted.map((d) => {
    inputTokens += d.inputTokens
    outputTokens += d.outputTokens
    cost += d.cost
    steps += d.steps
    return { key: d.day, label: d.day.slice(5), inputTokens, outputTokens, cost, steps }
  })
}

export function UsagePage(): React.ReactElement {
  const [range, setRange] = useState<Range>("daily")
  const usage = useApi<UsageSummary>(() => api.usage(30), [])
  const navigate = useNavigate()

  const buckets = useMemo<Bucket[]>(() => {
    const days = usage.data?.days ?? []
    if (range === "weekly") return weeklyBuckets(days)
    if (range === "cumulative") return cumulativeBuckets(days)
    return days.map((d) => ({ key: d.day, label: d.day.slice(5), inputTokens: d.inputTokens, outputTokens: d.outputTokens, cost: d.cost, steps: d.steps }))
  }, [usage.data, range])

  // 统计卡反映当前视图：由展示桶求和得出（三种范围覆盖同一批 days，总量一致）。
  const shown = useMemo(() => {
    const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0, steps: 0 }
    for (const d of usage.data?.days ?? []) {
      sum.inputTokens += d.inputTokens
      sum.outputTokens += d.outputTokens
      sum.cacheReadTokens += d.cacheReadTokens ?? 0
      sum.cost += d.cost
      sum.steps += d.steps
    }
    if (range !== "cumulative" || buckets.length === 0) return sum
    const last = buckets[buckets.length - 1]!
    return { ...sum, inputTokens: last.inputTokens, outputTokens: last.outputTokens, cost: last.cost, steps: last.steps }
  }, [usage.data, buckets, range])

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
  const modelTotal = modelSplit.reduce((s, [, x]) => s + x.in + x.out, 0)

  const topSessions = useMemo(
    () => [...(usage.data?.sessionRows ?? [])].sort((a, b) => b.cost - a.cost).slice(0, 10),
    [usage.data],
  )

  const RANGE_LABEL: Record<Range, string> = { daily: "每日", weekly: "每周", cumulative: "累计" }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="用量分析" backTo="/settings"
        sub="按天聚合自事件日志（Session.StepEnded）；每周/累计视图由每日数据在客户端重聚合。"
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
        {() => (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={<TrendingUp size={15} />} label={range === "cumulative" ? "累计 tokens" : "总 tokens"} value={fmtTokens(shown.inputTokens + shown.outputTokens)} sub={`输入 ${fmtTokens(shown.inputTokens)} · 输出 ${fmtTokens(shown.outputTokens)}`} />
              <StatCard icon={<Coins size={15} />} label="估算成本" value={`¥${shown.cost.toFixed(2)}`} sub="按供应商单价折算" />
              <StatCard icon={<Footprints size={15} />} label="模型调用次数" value={String(shown.steps)} sub={`${usage.data?.sessions ?? 0} 个会话`} />
              <StatCard icon={<Cpu size={15} />} label="缓存读取" value={fmtTokens(shown.cacheReadTokens)} sub="prefix cache 命中" />
            </div>

            {/* range chart */}
            <section className="card mt-5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-fg">{range === "daily" ? "活动热力（近 30 天）" : range === "weekly" ? "每周聚合" : "累计趋势"}</h2>
                {range === "daily" ? <HeatLegend /> : <span className="text-2xs text-faint">{RANGE_LABEL[range]}视图 · {buckets.length} 个{buckets.length === 0 ? "" : range === "weekly" ? "周" : "点"}</span>}
              </div>
              {range === "daily" && <Heatmap days={usage.data?.days ?? []} />}
              {range === "weekly" && <WeeklyBars buckets={buckets} />}
              {range === "cumulative" && <CumulativeBars buckets={buckets} />}
              {range === "daily" && <p className="mt-2 text-2xs text-faint">{peakSummary(usage.data?.days ?? [])}</p>}
              {range === "cumulative" && buckets.length > 0 && (
                <p className="mt-2 text-2xs text-faint">
                  截至 {buckets[buckets.length - 1]!.key}，累计 {fmtTokens(shown.inputTokens + shown.outputTokens)} tokens · ¥{shown.cost.toFixed(2)}。
                </p>
              )}
            </section>

            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              {/* session ranking — top 10 by cost */}
              <section className="card overflow-hidden">
                <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-fg">会话排行（按成本 Top 10）</h2>
                <div>
                  {topSessions.map((r, i) => (
                    <button key={r.sessionId} onClick={() => navigate(`/session/${r.sessionId}`)} className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-b-0 hover:bg-hover">
                      <span className="w-4 flex-none text-center font-mono text-2xs text-ghost">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-2xs text-fg">{r.sessionId}</span>
                        <span className="block text-2xs text-faint">{relativeTime(r.lastActivity)} · {r.steps} 次调用</span>
                      </span>
                      {r.model && <span className="hidden flex-none font-mono text-2xs text-faint md:block">{r.model}</span>}
                      <span className="flex-none font-mono text-2xs text-dim">{fmtTokens(r.inputTokens + r.outputTokens)}</span>
                      <span className="flex-none font-mono text-2xs text-faint">¥{r.cost.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* model split */}
              <section className="card overflow-hidden">
                <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-fg">按模型分列</h2>
                <div className="p-4">
                  {modelSplit.length === 0 && <p className="text-2xs text-faint">暂无模型归因数据</p>}
                  {modelSplit.map(([m, v]) => {
                    const ratio = modelTotal > 0 ? (v.in + v.out) / modelTotal : 0
                    return (
                      <div key={m} className="mb-2.5 last:mb-0">
                        <div className="flex items-center justify-between font-mono text-2xs">
                          <span className="text-dim">{m}</span>
                          <span className="text-faint">{fmtTokens(v.in + v.out)} · {(ratio * 100).toFixed(1)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg2">
                          <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: "var(--txt-dim)" }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        )}
      </AsyncRegion>
    </div>
  )
}

function peakSummary(days: UsageDay[]): string {
  const peak = days.reduce<UsageDay | undefined>((p, d) => (d.inputTokens + d.outputTokens > (p ? p.inputTokens + p.outputTokens : -1) ? d : p), undefined)
  if (!peak) return ""
  return `最活跃日期是 ${peak.day}，约 ${fmtTokens(peak.inputTokens + peak.outputTokens)} tokens。`
}

/** 每周：横向条 —— 周一日期标签 + tokens 占比条 + 成本/步数。 */
function WeeklyBars({ buckets }: { buckets: Bucket[] }): React.ReactElement {
  const max = Math.max(1, ...buckets.map((b) => b.inputTokens + b.outputTokens))
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <div key={b.key} className="flex items-center gap-3">
          <span className="w-20 flex-none font-mono text-2xs text-dim">{b.label}</span>
          <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-md bg-bg2">
            <div
              className="h-full rounded-md"
              style={{ width: `${((b.inputTokens + b.outputTokens) / max) * 100}%`, background: "color-mix(in srgb, var(--txt) 55%, var(--bg2))" }}
              title={`${b.key} 周 · ${fmtTokens(b.inputTokens + b.outputTokens)} tokens`}
            />
          </div>
          <span className="w-36 flex-none text-right font-mono text-2xs text-faint">
            {fmtTokens(b.inputTokens + b.outputTokens)} · ¥{b.cost.toFixed(2)} · {b.steps} 次
          </span>
        </div>
      ))}
    </div>
  )
}

/** 累计：竖向单调递增柱（无图表库，div 高度即运行求和曲线）。 */
function CumulativeBars({ buckets }: { buckets: Bucket[] }): React.ReactElement {
  const last = buckets[buckets.length - 1]
  const max = Math.max(1, last ? last.inputTokens + last.outputTokens : 0)
  return (
    <div className="flex h-32 items-end gap-[3px]">
      {buckets.map((b, i) => {
        const v = b.inputTokens + b.outputTokens
        const showLabel = i === 0 || i === buckets.length - 1 || i % 7 === 0
        return (
          <div key={b.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full rounded-t-[3px]"
              style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: "color-mix(in srgb, var(--txt) 55%, var(--bg2))" }}
              title={`截至 ${b.key} · 累计 ${fmtTokens(v)} tokens · ¥${b.cost.toFixed(2)}`}
            />
            <span className={`h-3 font-mono text-[9px] text-ghost ${showLabel ? "" : "invisible"}`}>{b.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// Fixed light→dark ramp driven by the foreground colour (a fixed alpha ladder
// on --txt), so the shades step evenly and read correctly in both themes.
const HEAT_RAMP = [
  "var(--bg2)",
  "color-mix(in srgb, var(--txt) 16%, var(--bg2))",
  "color-mix(in srgb, var(--txt) 34%, var(--bg2))",
  "color-mix(in srgb, var(--txt) 58%, var(--bg2))",
  "color-mix(in srgb, var(--txt) 88%, var(--bg2))",
]

function Heatmap({ days }: { days: UsageSummary["days"] }): React.ReactElement {
  const max = Math.max(1, ...days.map((d) => d.inputTokens + d.outputTokens))
  return (
    <div className="flex flex-wrap gap-[3px]">
      {days.map((d) => {
        const v = d.inputTokens + d.outputTokens
        const level = v === 0 ? 0 : v / max > 0.75 ? 4 : v / max > 0.5 ? 3 : v / max > 0.25 ? 2 : 1
        return (
          <div
            key={d.day}
            title={`${d.day} · ${fmtTokens(v)} tokens · ¥${d.cost.toFixed(2)}`}
            className="h-[26px] w-[26px] rounded-[4px]"
            style={{ background: HEAT_RAMP[level] }}
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
      {HEAT_RAMP.map((c, i) => (
        <span key={i} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
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
