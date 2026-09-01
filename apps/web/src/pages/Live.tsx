/**
 * Live — cross-process directory view (/v1/live): which runtime endpoint owns
 * which session, with pid and heartbeat. Weak-need page (pre-review §3.1);
 * heartbeat freshness is derived client-side.
 */
import { Network, Radio } from "lucide-react"
import { api } from "../api/client"
import type { LiveView } from "../api/types"
import { relativeTime } from "../api/fold"
import { useApi } from "../lib/useApi"
import { AsyncRegion, EmptyState, PageHeader } from "../components/ui"

export function LivePage(): React.ReactElement {
  const live = useApi<LiveView>(() => api.live(), [])
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="运行状态" sub="跨进程会话注册：多个运行时并存时，每个会话由哪个 endpoint / 进程持有，心跳是否新鲜。" backTo="/settings" />
      <AsyncRegion
        state={live}
        emptyIf={(d) => d.live.length === 0}
        empty={<EmptyState className="!py-24" icon={<Network size={18} />} title="没有在线运行时" hint="启动一个 server 进程后，它持有的会话会出现在这里。" />}
      >
        {(d) => (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="card overflow-hidden">
              <div className="grid grid-cols-[1fr_1.4fr_80px_120px] gap-3 border-b border-line bg-bg2 px-4 py-2 text-2xs font-medium uppercase tracking-wide text-faint">
                <span>会话</span>
                <span>Endpoint</span>
                <span>PID</span>
                <span>心跳</span>
              </div>
              {d.live.map((e) => {
                const fresh = Date.now() - e.heartbeatAt < 30_000
                return (
                  <div key={`${e.endpoint}-${e.sessionId}`} className="grid grid-cols-[1fr_1.4fr_80px_120px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover">
                    <span className="truncate font-mono text-2xs text-fg">{e.sessionId}</span>
                    <span className="truncate font-mono text-2xs text-dim">{e.endpoint}</span>
                    <span className="font-mono text-2xs text-faint">{e.pid}</span>
                    <span className="flex items-center gap-1.5 text-2xs">
                      <Radio size={11} className={fresh ? "text-ok" : "text-warn"} />
                      <span className={fresh ? "text-ok" : "text-warn"}>{relativeTime(e.heartbeatAt)}</span>
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-2xs text-faint">本进程：<span className="font-mono">{d.self}</span> · 注册数据跨进程共享（SQLite），心跳过期的条目会被清扫。</p>
          </div>
        )}
      </AsyncRegion>
    </div>
  )
}
