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
import { useWorkspace } from "../lib/workspace"
import { EmotionBall } from "../components/EmotionBall"
import { Composer } from "../components/Composer"
import { StatusDot } from "../components/ui"

const SUGGESTIONS = ["读取当前仓库结构并总结", "帮我写一个周报草稿", "检查最近改动的代码质量", "给这个项目写一份 README"]

export function Cover(): React.ReactElement {
  const navigate = useNavigate()
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [])
  const settings = useApi<import("../api/types").SettingsView>(() => api.settings(), [])
  const models = useApi<string[]>(() => api.models(), [])
  const [focused, setFocused] = useState(false)
  // The composer model chip must show the ENGINE's active model, not a default.
  const activeModel = settings.data?.model ?? "…"

  const recent = (sessions.data ?? [])
    .filter((r) => r.role !== "butler" && !r.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4)

  const [busyBoot, setBusyBoot] = useState(false)
  // Cover submit: every task gets its OWN session in the selected workspace
  // (the resident butler session stays pinned in the sidebar as the
  // coordinator — it is not a catch-all conversation).
  const [ws] = useWorkspace(settings.data?.workspace)
  const newTask = (draft: string): void => {
    if (busyBoot) return
    setBusyBoot(true)
    void api.createSession(undefined, ws || undefined)
      .then((r) => {
        if (draft) sessionStorage.setItem("nh-draft", draft)
        navigate(`/session/${r.sessionId}`)
      })
      .catch((e) => window.alert("新建会话失败：" + (e instanceof Error ? e.message : String(e))))
      .finally(() => setBusyBoot(false))
  }

  return (
    // Fixed, non-scrolling welcome on mobile (just ball + composer); the
    // suggestion/recent sections scroll only on larger screens.
    <div className="h-full overflow-hidden md:overflow-y-auto">
      <div className="mx-auto flex h-full w-full max-w-[760px] flex-col px-5 pt-[4vh] md:min-h-full md:px-6 md:pb-16 md:pt-[7vh]">
        {/* hero: ball in orbit ring */}
        <div className="flex justify-center">
          <OrbitBall mood={focused ? "listening" : "idle"} />
        </div>

        <h1 className="mt-5 text-center text-[23px] font-bold tracking-tight text-fg md:mt-7 md:text-[30px]">有什么可以帮你？</h1>
        <p className="mt-2 text-center text-[14px] text-faint md:mt-2.5 md:text-[15px]">把任务交给 newhorse，它会自己读文件、跑工具、拆分子任务</p>

        {/* mobile spacer: pushes the composer to the bottom (chat-app convention) */}
        <div className="flex-1 md:hidden" />

        {/* Mobile: chat-app convention — the input lives at the bottom of the
            viewport (safe-area padded), not mid-page. Desktop keeps the
            centered hero flow. */}
        <div
          className="mt-auto pb-[max(1rem,env(safe-area-inset-bottom))] md:mt-7 md:pb-0"
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={() => setFocused(false)}
        >
          <Composer variant="cover" autoFocus disabled={busyBoot} model={activeModel} models={models.data ?? []} onModelChange={(m) => void api.putSettings({ model: m }).then(() => settings.retry())} onSend={(body) => newTask(body)} />
        </div>

        {/* suggestion pills — desktop only (mobile keeps the cover fixed) */}
        <div className="mt-5 hidden flex-wrap justify-center gap-2 md:flex">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => newTask(s)}
              className="rounded-full border border-line bg-panel px-4 py-2 text-[13px] text-dim transition-colors hover:border-linestrong hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>

        {/* recent sessions — desktop only */}
        <div className="mt-14 hidden md:block">
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
    <div className="relative h-[150px] w-[150px] md:h-[230px] md:w-[230px]">
      <svg viewBox="0 0 230 230" className="absolute inset-0 h-full w-full">
        {/* dotted orbit ring — visible in both themes: neutral dots on the
            surface with a soft accent-tinted glow */}
        <circle
          cx="115"
          cy="115"
          r="92"
          fill="none"
          stroke="var(--txt-dim)"
          strokeWidth="2.4"
          strokeDasharray="0.1 11"
          strokeLinecap="round"
          opacity="0.55"
        />
        {/* orbiting satellite */}
        <g className="orbit-spin">
          <circle cx="27" cy="115" r="10" fill="var(--accent)" opacity="0.14" />
          <circle cx="27" cy="115" r="4.5" fill="var(--accent)" />
        </g>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="scale-[0.8] md:scale-100">
          <EmotionBall mood={mood} size={104} interactive />
        </div>
      </div>
    </div>
  )
}
