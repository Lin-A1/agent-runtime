/**
 * Composer — the prompt bar shared by cover and session. Reference shape: a
 * tall rounded card, a model chip + attach tools on the bottom-left, a round
 * accent send button (ArrowUp) on the bottom-right; while a turn runs the send
 * button becomes a red Stop and further sends are admitted as steer/queue.
 * Also carries image attachments, slash-command (/) and @-mention popups.
 * Data is hard-coded this pass; submit/steer/interrupt are wired to the api
 * stub names so wiring day only swaps the stub body.
 */
import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowUp,
  AtSign,
  ChevronDown,
  FileText,
  ImagePlus,
  Paperclip,
  Sparkles,
  Square,
  Users,
  Zap,
} from "lucide-react"
import { api } from "../api/client"
import type { ChatImage, SessionRow } from "../api/types"
import { placeholderImage } from "../fixtures/util"
import { BUTLER_NH } from "../fixtures/sessions"
import { useApi } from "../lib/useApi"
import { imageUrl } from "../api/fold"

export interface ComposerProps {
  variant?: "cover" | "session"
  busy?: boolean
  queuedCount?: number
  autoFocus?: boolean
  placeholder?: string
  model?: string
  onInterrupt?: () => void
}

export function Composer({ variant = "session", busy = false, queuedCount = 0, autoFocus, placeholder, model = "claude-sonnet-4-5", onInterrupt }: ComposerProps): React.ReactElement {
  const navigate = useNavigate()
  const [text, setText] = useState("")
  const [images, setImages] = useState<ChatImage[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const commands = useApi(() => api.commands(), [])
  const skills = useApi(() => api.skills(), [])
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [])

  const showSlash = text.startsWith("/") && !text.includes(" ")
  const showMention = /(^|\s)@[^\s]*$/.test(text)

  const submit = (): void => {
    const body = text.trim()
    if (!body && images.length === 0) return
    if (variant === "cover") {
      navigate(`/session/${BUTLER_NH}`)
      return
    }
    setText("")
    setImages([])
  }

  const addFixtureImage = (): void => {
    if (images.length >= 5) return
    setImages((p) => [...p, placeholderImage(`shot-${p.length}`)])
  }

  const insertMention = (label: string): void => {
    setText((t) => t.replace(/@[^\s]*$/, `@${label} `))
    taRef.current?.focus()
  }

  return (
    <div className="w-full">
      {queuedCount > 0 && !busy && (
        <div className="mb-2 flex items-center justify-between rounded-xl border border-line bg-bg2 px-3.5 py-2 text-xs text-dim">
          <span className="flex items-center gap-2">
            <Zap size={13} className="text-warn" />
            {queuedCount} 条消息排队中，将在回合结束后自动发送
          </span>
          <button className="btn !py-1 text-2xs">立即发送</button>
        </div>
      )}

      <div
        className="overflow-hidden border bg-panel shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition-colors"
        style={{ borderRadius: 20, borderColor: busy ? "var(--line)" : "var(--line-strong)" }}
      >
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3.5">
            {images.map((img, i) => (
              <div key={i} className="group relative h-16 w-20 overflow-hidden rounded-lg border border-line">
                <img src={imageUrl(img)} alt="附件" className="h-full w-full object-cover" />
                <button
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[11px] leading-none text-white opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          value={text}
          autoFocus={autoFocus}
          rows={variant === "cover" ? 2 : 2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder ?? (busy ? "回合进行中——发送将作为追加（steer），下一个安全边界晋升" : "描述一个任务…")}
          className="w-full resize-none bg-transparent px-4 pb-2 pt-4 text-[15px] leading-relaxed text-fg outline-none placeholder:text-ghost"
        />

        {showSlash && (
          <div className="mx-3 mb-2 max-h-44 overflow-y-auto rounded-xl border border-line bg-bg2 p-1">
            {commands.data.commands.map((c) => (
              <button
                key={c.name}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-dim hover:bg-hover hover:text-fg"
                onClick={() => {
                  setText(`/${c.name} `)
                  taRef.current?.focus()
                }}
              >
                <Sparkles size={12} className="text-faint" />
                <span className="font-mono">/{c.name}</span>
                <span className="truncate text-2xs text-faint">{c.description}</span>
              </button>
            ))}
          </div>
        )}

        {showMention && (
          <div className="mx-3 mb-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-bg2 p-1">
            <MentionSection icon={<FileText size={12} />} title="文件">
              {["packages/runtime/src/dag-api.ts", "apps/web/src/api/fold.ts", "docs/architecture-map.md"].map((f) => (
                <MentionRow key={f} label={f} onPick={() => insertMention(f)} />
              ))}
            </MentionSection>
            <MentionSection icon={<Sparkles size={12} />} title="技能">
              {skills.data.skills.slice(0, 3).map((s) => (
                <MentionRow key={s.name} label={s.name} hint={s.description} onPick={() => insertMention(s.name)} />
              ))}
            </MentionSection>
            <MentionSection icon={<Users size={12} />} title="子智能体">
              {sessions.data
                .filter((s) => s.parentId)
                .slice(0, 4)
                .map((s) => (
                  <MentionRow key={s.sessionId} label={s.title ?? s.sessionId} onPick={() => insertMention(s.title ?? s.sessionId)} />
                ))}
            </MentionSection>
          </div>
        )}

        {/* bottom bar */}
        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
          <div className="flex items-center gap-1">
            <button className="icon-btn !h-8 !w-8" title="附加图片（粘贴 / 拖放 / 选择，发送前自动降采样）" onClick={addFixtureImage}>
              <ImagePlus size={16} />
            </button>
            <button className="icon-btn !h-8 !w-8" title="附加文件">
              <Paperclip size={16} />
            </button>
            <button
              className="icon-btn !h-8 !w-8"
              title="@ 提及：文件 / 技能 / 子智能体"
              onClick={() => {
                setText((t) => (t.endsWith("@") || t === "" ? t + "@" : t + " @"))
                taRef.current?.focus()
              }}
            >
              <AtSign size={16} />
            </button>
            <button className="ml-1 flex items-center gap-1.5 rounded-full border border-line bg-bg2 py-1.5 pl-2.5 pr-2 text-xs text-dim transition-colors hover:border-linestrong hover:text-fg" title="切换模型">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              <span className="font-mono text-2xs">{model}</span>
              <ChevronDown size={12} className="text-faint" />
            </button>
            {busy && (
              <span className="ml-1.5 flex items-center gap-1.5 text-2xs text-warn">
                <span className="dot dot-active" /> 回合进行中
              </span>
            )}
          </div>

          {busy ? (
            <button
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-white transition-colors"
              style={{ background: "var(--bad)" }}
              title="中断回合（SSE 断开即触发 interrupt）"
              onClick={onInterrupt}
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-white transition-all disabled:opacity-40"
              style={{ background: "var(--accent)" }}
              title="发送到常驻 newhorse 会话"
              onClick={submit}
              disabled={!text.trim() && images.length === 0}
            >
              <ArrowUp size={17} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MentionSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-faint">
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

function MentionRow({ label, hint, onPick }: { label: string; hint?: string; onPick: () => void }): React.ReactElement {
  return (
    <button onClick={onPick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-dim hover:bg-hover hover:text-fg">
      <Zap size={11} className="flex-none text-faint" />
      <span className="truncate font-mono">{label}</span>
      {hint && <span className="truncate text-2xs text-faint">{hint}</span>}
    </button>
  )
}
