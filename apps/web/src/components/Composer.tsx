/**
 * Composer — the prompt bar shared by cover and session. Reference shape: a
 * tall rounded card, a model chip + attach tools on the bottom-left, a round
 * accent send button (ArrowUp) on the bottom-right; while a turn runs the send
 * button becomes a red Stop and further sends are admitted as steer/queue.
 * Also carries image attachments, slash-command (/) and @-mention popups.
 * Data is hard-coded this pass; submit/steer/interrupt are wired to the api
 * stub names so wiring day only swaps the stub body.
 */
import { useEffect, useRef, useState } from "react"
import {
  ArrowUp,
  Check,
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
import { Dropdown, MenuItem } from "./ui"
import type { ChatImage, SessionRow } from "../api/types"
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
  /** Shell-stage local echo: the host decides what a send means (append a
   *  local turn / enqueue). Absent = the send just clears the input. */
  onSend?: (text: string, images?: ChatImage[]) => void
  /** Flush queued sends now ("立即发送"). */
  onFlushQueued?: () => void
  /** Fully inert (cover bootstrap in flight). */
  disabled?: boolean
  /** Prefill (cover draft handoff). */
  initialText?: string
  /** 可选模型列表（/v1/models）；给了 model chip 才变成可切换。 */
  models?: string[]
  /** 切换默认模型（写 settings.model，新会话生效）。 */
  onModelChange?: (m: string) => void
}

export function Composer({ variant = "session", busy = false, queuedCount = 0, autoFocus, placeholder, model = "", onInterrupt, onSend, onFlushQueued, disabled = false, initialText = "", models, onModelChange }: ComposerProps): React.ReactElement {
  const [text, setText] = useState(initialText)
  const [images, setImages] = useState<ChatImage[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const commands = useApi(() => api.commands(), [])
  const skills = useApi(() => api.skills(), [])
  const sessions = useApi<SessionRow[]>(() => api.sessions(), [])
  // @ files come from the real workspace root listing (/v1/fs, sandboxed).
  const rootFiles = useApi(() => api.fs(undefined, "."), [])

  const slashQ = text.startsWith("/") && !text.includes(" ") ? text.slice(1).toLowerCase() : null
  const showSlash = slashQ !== null
  const mentionQ = /(^|\s)@([^\s]*)$/.exec(text)?.[2] ?? null
  const showMention = mentionQ !== null

  const submit = (): void => {
    if (disabled) return
    const body = text.trim()
    if (!body && images.length === 0) return
    if (variant === "cover") {
      onSend?.(body)
      return
    }
    onSend?.(body, images)
    setText("")
    setImages([])
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const addRealImages = (files: FileList | null): void => {
    if (!files) return
    const room = 5 - images.length
    const picked = Array.from(files).slice(0, Math.max(0, room))
    for (const f of picked) {
      // Engine cap: 4MiB base64 per image — read now, refuse early.
      if (f.size > 3_000_000) {
        window.alert(`图片 ${f.name} 超过 3MB（引擎上限约 4MB base64），请压缩后再试。`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "")
        const comma = dataUrl.indexOf(",")
        if (comma < 0) return
        const mime = dataUrl.slice(5, comma).split(";")[0] || f.type || "image/png"
        const data = dataUrl.slice(comma + 1)
        setImages((p) => (p.length >= 5 ? p : [...p, { mime, data }]))
      }
      reader.readAsDataURL(f)
    }
  }

  // Command palette slash rows insert into the active composer via this bridge.
  useEffect(() => {
    const onInsert = (e: Event): void => {
      const t = (e as CustomEvent<string>).detail
      if (typeof t !== "string") return
      setText((prev) => (prev.endsWith(" ") || prev === "" ? prev + t : prev + " " + t))
      taRef.current?.focus()
    }
    window.addEventListener("nh-composer-insert", onInsert)
    return () => window.removeEventListener("nh-composer-insert", onInsert)
  }, [])

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
          <button className="btn !py-1 text-2xs" onClick={onFlushQueued}>立即发送</button>
        </div>
      )}

      <div
        className={`overflow-hidden border bg-panel transition-colors focus-within:border-linestrong ${dragOver ? "border-accent" : ""}`}
        style={{ borderRadius: 22, borderColor: dragOver ? "var(--accent)" : "var(--line)" }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          addRealImages(e.dataTransfer?.files ?? null)
        }}
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
          onPaste={(e) => {
            // 粘贴图片走与选择/拖放相同的附件管线（引擎上限在 addRealImages 内校验）。
            if (e.clipboardData.files.length > 0) addRealImages(e.clipboardData.files)
          }}
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
            {(commands.data?.commands ?? [])
              .filter((c) => !slashQ || c.name.toLowerCase().includes(slashQ))
              .map((c) => (
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
            {(commands.data?.commands ?? []).filter((c) => !slashQ || c.name.toLowerCase().includes(slashQ)).length === 0 && (
              <div className="px-2.5 py-2 text-2xs text-ghost">没有匹配的命令（命令来自 plugins/commands/*.md）</div>
            )}
          </div>
        )}

        {showMention && (
          <div className="mx-3 mb-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-bg2 p-1">
            <MentionSection icon={<FileText size={12} />} title="文件（工作区根目录）">
              {(rootFiles.data?.entries ?? [])
                .filter((f) => !mentionQ || f.name.toLowerCase().includes(mentionQ.toLowerCase()))
                .slice(0, 6)
                .map((f) => (
                  <MentionRow key={f.name} label={f.dir ? f.name + "/" : f.name} onPick={() => insertMention(f.dir ? f.name + "/" : f.name)} />
                ))}
              {(rootFiles.data?.entries ?? []).length === 0 && <div className="px-2.5 py-1.5 text-2xs text-ghost">工作区为空或未配置</div>}
            </MentionSection>
            <MentionSection icon={<Sparkles size={12} />} title="技能">
              {(skills.data?.skills ?? [])
                .filter((s) => !mentionQ || s.name.toLowerCase().includes(mentionQ.toLowerCase()))
                .slice(0, 4)
                .map((s) => (
                  <MentionRow key={s.name} label={s.name} hint={s.description} onPick={() => insertMention(s.name)} />
                ))}
            </MentionSection>
            <MentionSection icon={<Users size={12} />} title="子智能体">
              {(sessions.data ?? [])
                .filter((s) => s.parentId && (!mentionQ || (s.title ?? s.sessionId).toLowerCase().includes(mentionQ.toLowerCase())))
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
            <input hidden ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple              onChange={(e) => {
                addRealImages(e.target.files)
                e.target.value = ""
              }} />
            <button className="icon-btn !h-8 !w-8" title="附加图片（选择 / 粘贴 / 拖放，引擎侧内容寻址）" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={16} />
            </button>
            <button className="icon-btn !h-8 !w-8 cursor-not-allowed opacity-40" disabled title="引擎暂只支持图片附件——任意文件附件已列入引擎计划（附件库已内容寻址）">
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
            <div className="ml-1 hidden min-w-0 items-center min-[420px]:flex">
              <Dropdown
                width={260}
                trigger={
                  <button className="flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs text-dim transition-colors hover:bg-hover hover:text-fg" title="切换默认模型（新会话生效）">
                    <span className="max-w-[120px] truncate font-mono text-2xs">{model}</span>
                    <ChevronDown size={12} className="flex-none text-ghost" />
                  </button>
                }
              >
                {(close) => (
                  <>
                    {(models ?? []).map((m) => (
                      <MenuItem
                        key={m}
                        icon={m === model ? <Check size={13} className="text-fg" /> : <span className="inline-block w-[13px]" />}
                        onClick={() => {
                          onModelChange?.(m)
                          close()
                        }}
                      >
                        <span className="block truncate font-mono text-[13px]">{m}</span>
                      </MenuItem>
                    ))}
                    {(models ?? []).length === 0 && <div className="px-2 py-2 text-2xs text-ghost">未拉取到模型列表（设置页可一键拉取）</div>}
                  </>
                )}
              </Dropdown>
            </div>
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
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors"
              style={{
                background: (text.trim() || images.length > 0) ? "var(--txt)" : "var(--hover-2)",
                color: (text.trim() || images.length > 0) ? "var(--bg)" : "var(--txt-faint)",
              }}
              title={variant === "cover" ? "新建会话并发送" : "发送"}
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
