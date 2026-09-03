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
  | "boot" // 加载苏醒
  | "idle" // 待机放空
  | "listening" // 等待输入
  | "thinking" // 思考中(常驻环带)
  | "working" // 处理中忙碌
  | "searching" // 检索资料
  | "replying" // 输出回复
  | "done" // 任务完成(彩带 + 撒花)
  | "error" // 出错
  | "sleep" // 睡眠(zzz)

const MOOD_ID: Record<BallMood, string> = {
  boot: "05",
  idle: "02",
  listening: "35",
  thinking: "30",
  working: "32",
  searching: "40",
  replying: "39",
  done: "33",
  error: "34",
  sleep: "00",
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
      emotion: MOOD_ID[moodRef.current],
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
    engineRef.current?.setEmotion(MOOD_ID[mood])
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
    document.addEventListener("mouseleave", onLeave)

    return () => {
      window.removeEventListener("pointermove", onPointerMove)
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
