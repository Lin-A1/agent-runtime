import { useEffect, useRef } from "react"
import { createEmotionBall } from "../lib/emotion-ball/engine"
import { mount as mountParticles } from "../lib/emotion-ball/particles"

/**
 * React wrapper over the vendored Emotion Ball engine
 * (github.com/sam70361/aora-bot, community-licensed). A `mood` maps onto the
 * engine's emotion-id vocabulary (emotions.ts: 00-09 lifecycle, 10-29 moods,
 * 30-49 agent states). The engine owns blinking / glancing / idle antics /
 * ribbons / confetti; this component only forwards mood changes and pointer
 * gaze. The ball is the product's only "face" — cover hero, brand mark and
 * session avatars, never decorative scatter.
 */

export type BallMood =
  // Lifecycle (00-07)
  | "sleep" // 00 睡眠(zzz)
  | "wake" // 01 唤醒
  | "idle" // 02 待机放空
  | "curious" // 03 好奇
  | "daydream" // 04 发呆
  | "boot" // 05 加载苏醒
  | "dormant" // 06 休眠
  | "shake" // 07 抖动唤醒
  // Emotions (10-21)
  | "happy" // 10 开心
  | "puzzled" // 11 疑惑
  | "down" // 12 失落
  | "surprised" // 13 惊讶
  | "shy" // 14 害羞
  | "tired" // 15 疲惫
  | "focused" // 16 专注
  | "panicked" // 17 慌张
  | "resigned" // 18 无奈
  | "satisfied" // 19 满意
  | "confused" // 20 困惑
  | "angry" // 21 生气
  // Agent States (30-41)
  | "thinking" // 30 思考中(常驻环带)
  | "receiving" // 31 接收任务(点头)
  | "working" // 32 处理中忙碌
  | "done" // 33 任务完成(彩带 + 撒花)
  | "error" // 34 出错(红光警报)
  | "listening" // 35 等待输入
  | "loading" // 36 联网加载
  | "recalling" // 37 复述回忆/记忆检索
  | "refusing" // 38 拒绝/受限
  | "replying" // 39 输出回复(律动脉冲)
  | "searching" // 40 检索资料
  | "poweroff" // 41 停止终止
  | (string & {}) // 允许直接透传 32 套表情 seed ID

const MOOD_ID: Record<string, string> = {
  // Lifecycle
  sleep: "00",
  wake: "01",
  idle: "02",
  curious: "03",
  daydream: "04",
  boot: "05",
  dormant: "06",
  shake: "07",
  // Emotions
  happy: "10",
  puzzled: "11",
  down: "12",
  surprised: "13",
  shy: "14",
  tired: "15",
  focused: "16",
  panicked: "17",
  resigned: "18",
  satisfied: "19",
  confused: "20",
  angry: "21",
  // Agent States
  thinking: "30",
  receiving: "31",
  working: "32",
  done: "33",
  error: "34",
  listening: "35",
  loading: "36",
  recalling: "37",
  refusing: "38",
  replying: "39",
  searching: "40",
  poweroff: "41",
}

function resolveEmotionId(mood: BallMood): string {
  if (MOOD_ID[mood]) return MOOD_ID[mood]
  if (/^\d{2}$/.test(mood)) return mood
  return "02"
}

interface Props {
  mood: BallMood
  size?: number
  /** Static single render (avatars): no rAF, no idle machine. */
  lite?: boolean
  /** Pointer gaze + click-to-spin (cover hero only). */
  interactive?: boolean
  /** Whether to render the celestial planetary ring (星环). Only true on main hero stage. Defaults to false. */
  hasRing?: boolean
  className?: string
}

export function EmotionBall({ mood, size = 96, lite = false, interactive = false, hasRing = false, className }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  // engine is vendored untyped code; keep the handle loose
  const engineRef = useRef<{
    setEmotion: (id: string) => boolean
    setGaze: (x: number, y: number) => unknown
    clearGaze?: () => unknown
    spin: (t?: number) => unknown
    burst?: () => unknown
    destroy: () => void
  } | null>(null)
  const moodRef = useRef(mood)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const engine = createEmotionBall(host, {
      emotion: resolveEmotionId(moodRef.current),
      lite,
      hasRing,
      ...(lite ? {} : { idle: { standbyAfter: 60_000, sleepAfter: 180_000, standbyId: "02", sleepId: "00" } }),
      eyeScale: size < 56 ? 1.25 : 1,
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // size only matters at construction; mood changes flow through setEmotion
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lite, hasRing])

  useEffect(() => {
    moodRef.current = mood
    engineRef.current?.setEmotion(resolveEmotionId(mood))
    if (mood === "done") engineRef.current?.burst?.()
  }, [mood])

  useEffect(() => {
    if (!interactive) return
    const host = hostRef.current
    if (!host) return

    const handleMove = (clientX: number, clientY: number): void => {
      const engine = engineRef.current
      const currentHost = hostRef.current
      if (!engine || !currentHost) return
      const r = currentHost.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const dx = clientX - cx
      const dy = clientY - cy

      // Responsive gaze radius: 260px saturation so eyes track naturally across screen
      const maxRadius = Math.max(size * 2.2, 280)
      const nx = Math.max(-1, Math.min(1, dx / maxRadius))
      const ny = Math.max(-1, Math.min(1, dy / maxRadius))
      engine.setGaze(nx, ny)

      // Subtle 3D tilt tracking for head/planet body
      currentHost.style.transform = `perspective(600px) rotateY(${nx * 10}deg) rotateX(${-ny * 8}deg)`
    }

    const onPointerMove = (e: PointerEvent): void => handleMove(e.clientX, e.clientY)
    const onLeave = (): void => {
      engineRef.current?.clearGaze?.()
      if (hostRef.current) hostRef.current.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg)"
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("pointerup", onLeave)
    window.addEventListener("touchend", onLeave)
    window.addEventListener("touchcancel", onLeave)
    document.addEventListener("mouseleave", onLeave)

    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onLeave)
      window.removeEventListener("touchend", onLeave)
      window.removeEventListener("touchcancel", onLeave)
      document.removeEventListener("mouseleave", onLeave)
    }
  }, [interactive, size])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        width: size,
        height: size,
        cursor: interactive ? "pointer" : undefined,
        flex: "none",
        transition: "transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onClick={interactive ? () => engineRef.current?.spin(1) : undefined}
      role={interactive ? "img" : undefined}
      aria-label={interactive ? "newhorse" : undefined}
      aria-hidden={interactive ? undefined : true}
    />
  )
}

/** Breathing starfield/halftone backdrop for the cover (same vendored source). */
export function HeroParticles({ className }: { className?: string }): React.ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    return mountParticles(canvas) ?? undefined
  }, [])
  return <canvas ref={ref} className={className} aria-hidden />
}
