/**
 * Cover — the welcome entry. Per the agreed reference: a clean dark field (no
 * starfield), the emotion ball small and centered inside a dashed orbit ring
 * with a satellite dot, a bold greeting, the rounded composer (model chip +
 * round send), wrap-around suggestion pills, and below a ruled "最近会话"
 * section with a two-column card grid. Submitting goes straight into the
 * resident newhorse session. All data is hard-coded this pass.
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../api/client"
import type { SessionRow } from "../api/types"
import { prettyTitle, relativeTime } from "../api/fold"
import { useApi } from "../lib/useApi"
import { EmotionBall } from "../components/EmotionBall"
import { Composer } from "../components/Composer"
import { StatusDot } from "../components/ui"

const SUGGESTIONS = ["读取当前仓库结构并总结", "帮我写一个周报草稿", "检查最近改动的代码质量", "给这个项目写一份 README"]

export function Cover(): React.ReactElement {
  const navigate = useNavigate()
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [])
  const [focused, setFocused] = useState(false)

  const recent = sessions.data
    .filter((r) => r.role !== "butler" && !r.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pb-16 pt-[7vh]">
        {/* hero: ball in orbit ring */}
        <div className="flex justify-center">
          <OrbitBall mood={focused ? "listening" : "idle"} />
        </div>

        <h1 className="mt-7 text-center text-[30px] font-bold tracking-tight text-fg">有什么可以帮你？</h1>
        <p className="mt-2.5 text-center text-[15px] text-faint">把任务交给 newhorse，它会自己读文件、跑工具、拆分子任务</p>

        <div
          className="mt-7"
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={() => setFocused(false)}
        >
          <Composer variant="cover" autoFocus />
        </div>

        {/* suggestion pills */}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => navigate("/session/sess-nh-butler")}
              className="rounded-full border border-line bg-panel px-4 py-2 text-[13px] text-dim transition-colors hover:border-linestrong hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>

        {/* recent sessions */}
        <div className="mt-14">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[13px] font-medium text-dim">最近会话</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recent.map((r) => (
              <button
                key={r.sessionId}
                onClick={() => navigate(`/session/${r.sessionId}`)}
                className="card group p-4 text-left transition-colors hover:border-linestrong hover:bg-cardhover"
              >
                <p className="line-clamp-2 min-h-[40px] text-[15px] font-semibold leading-snug text-fg">
                  {prettyTitle(r.title, "未命名会话", 60)}
                </p>
                <div className="mt-3 flex items-center gap-2 text-2xs text-ghost">
                  <StatusDot status={r.status} />
                  <span>{relativeTime(r.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Small emotion ball centered inside a faint dotted orbit ring with a
 *  satellite that slowly orbits. */
function OrbitBall({ mood }: { mood: "idle" | "listening" }): React.ReactElement {
  return (
    <div className="relative" style={{ width: 230, height: 230 }}>
      <svg viewBox="0 0 230 230" className="absolute inset-0 h-full w-full">
        {/* faint dotted ring (round caps + tiny dashes read as dots) */}
        <circle
          cx="115"
          cy="115"
          r="92"
          fill="none"
          stroke="var(--txt-ghost)"
          strokeWidth="1.6"
          strokeDasharray="0.1 9.5"
          strokeLinecap="round"
          opacity="0.45"
        />
        {/* orbiting satellite */}
        <g className="orbit-spin">
          <circle cx="27" cy="115" r="4.5" fill="var(--txt-dim)" />
          <circle cx="27" cy="115" r="9" fill="var(--txt-dim)" opacity="0.1" />
        </g>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <EmotionBall mood={mood} size={104} interactive />
      </div>
    </div>
  )
}
