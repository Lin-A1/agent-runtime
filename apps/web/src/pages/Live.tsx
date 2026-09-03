/**
 * Live — cross-process directory view (/v1/live): which runtime endpoint owns
 * which session, with pid and heartbeat. 心跳年龄按秒级时钟（5s tick）实时
 * 刷新；超过 30s 未心跳的条目标灰为「失联」；本进程 endpoint 高亮；点击行
 * 跳转对应会话。
 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Network, Radio } from "lucide-react"
import { api } from "../api/client"
import { useBusRefresh } from "../api/bus"
import type { LiveView } from "../api/types"
import { relativeTime } from "../api/fold"
import { useApi } from "../lib/useApi"
import { AsyncRegion, EmptyState, PageHeader } from "../components/ui"

/** 心跳年龄：秒级精确到 1 分钟，之后退回 relativeTime 的粗粒度表述。 */
function heartbeatAge(ts: number, now: number): string {
  const diff = now - ts
  if (diff < 5_000) return "刚刚"
  if (diff < 60_000) return `${Math.floor(diff / 1_000)} 秒前`
  return relativeTime(ts)
}

export function LivePage(): React.ReactElement {
  const navigate = useNavigate()
  const live = useApi<LiveView>(() => api.live(), [])
  // Refresh on settle frames (throttled) + a 10s heartbeat-freshness fallback —
  // the page otherwise never refetches after first load.
  useBusRefresh(
    (f) => f.event.type === "result" || f.event.type === "done" || f.event.type === "error",
    () => live.retry(),
    2_000,
  )
  useEffect(() => {
    const t = setInterval(() => live.retry(), 10_000)
    return () => clearInterval(t)
  }, [live.retry])
  // 秒级时钟驱动心跳年龄与失联判定（不触发重新拉取）。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="运行状态" sub="跨进程会话注册：多个运行时并存时，每个会话由哪个 endpoint / 进程持有，心跳是否新鲜。" backTo="/settings" />
      <AsyncRegion
        state={live}
        emptyIf={(d) => d.live.length === 0}
        empty={<EmptyState className="!py-24" icon={<Network size={18} />} title="没有在线运行时" hint="启动一个 server 进程后，它持有的会话会出现在这里。" />}
      >
        {(d) => (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <div className="card overflow-x-auto">
              <div className="grid min-w-[640px] grid-cols-[1fr_1.4fr_80px_140px] gap-3 border-b border-line bg-bg2 px-4 py-2 text-2xs font-medium uppercase tracking-wide text-faint">
                <span>会话</span>
                <span>Endpoint</span>
                <span>PID</span>
                <span>心跳</span>
              </div>
              {d.live.map((e) => {
                const stale = now - e.heartbeatAt > 30_000
                const isSelf = e.endpoint === d.self
                return (
                  <div
                    key={`${e.endpoint}-${e.sessionId}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/session/${e.sessionId}`)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") navigate(`/session/${e.sessionId}`)
                    }}
                    className={`grid min-w-[640px] cursor-pointer grid-cols-[1fr_1.4fr_80px_140px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover ${stale ? "opacity-50" : ""}`}
                    style={isSelf ? { background: "color-mix(in srgb, var(--accent) 7%, transparent)", boxShadow: "inset 2px 0 0 var(--accent)" } : undefined}
                    title={`跳转会话 ${e.sessionId}`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-2xs text-fg">{e.sessionId}</span>
                      {isSelf && <span className="chip flex-none !py-0 !text-[10px]">本进程</span>}
                    </span>
                    <span className="truncate font-mono text-2xs text-dim">{e.endpoint}</span>
                    <span className="font-mono text-2xs text-faint">{e.pid}</span>
                    <span className="flex items-center gap-1.5 text-2xs">
                      <Radio size={11} className={stale ? "text-ghost" : "text-ok"} />
                      {stale ? (
                        <>
                          <span className="text-ghost">{heartbeatAge(e.heartbeatAt, now)}</span>
                          <span className="chip !py-0 !text-[10px] text-ghost">失联</span>
                        </>
                      ) : (
                        <span className="text-ok">{heartbeatAge(e.heartbeatAt, now)}</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 break-all text-2xs text-faint">本进程：<span className="font-mono">{d.self}</span> · 注册数据跨进程共享（SQLite），心跳过期的条目会被清扫。</p>
          </div>
        )}
      </AsyncRegion>
    </div>
  )
}
