import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  ImagePlus,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useApp, useStream } from "../state/store";
import { api } from "../api/client";
import type { ChatImage, PolicyLevel } from "../api/types";
import {
  cursorCompletion,
  replaceCompletion,
  type CursorCompletion,
} from "../lib/completion";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_TOTAL = 12 * 1024 * 1024;
const sessionDrafts = new Map<string, { text: string; images: ChatImage[] }>();
const POLICY_OPTIONS: Array<{
  value: PolicyLevel;
  label: string;
  hint: string;
}> = [
  { value: "strict", label: "严格审批", hint: "敏感操作逐条确认" },
  { value: "readonly", label: "只读模式", hint: "读取分析，写入需请求" },
  { value: "trusted", label: "完全访问", hint: "不弹出执行确认" },
];
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Sniff a file's real image type from its magic bytes when the browser reports
 *  an empty/generic type (common on Windows for files without a registered
 *  extension handler). Falls back to the reported type; "" when unrecognized. */
async function sniffImageMime(file: File): Promise<string> {
  if (file.type && IMAGE_TYPES.has(file.type)) return file.type
  const head = await new Promise<Uint8Array | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as ArrayBuffer | null) ? new Uint8Array(reader.result as ArrayBuffer).subarray(0, 12) : null)
    reader.onerror = () => resolve(null)
    reader.readAsArrayBuffer(file)
  })
  if (!head) return file.type
  const hex = Array.from(head).map((b) => b.toString(16).padStart(2, "0")).join("")
  if (hex.startsWith("89504e47")) return "image/png"
  if (hex.startsWith("ffd8ff")) return "image/jpeg"
  if (hex.startsWith("474946")) return "image/gif"
  if (hex.startsWith("52494646") && hex.slice(16, 20) === "57454250") return "image/webp"
  return file.type
}

function policyLabel(policy: PolicyLevel | null): string {
  return (
    POLICY_OPTIONS.find((option) => option.value === policy)?.label ??
    "读取策略…"
  );
}

export function Composer({
  sessionId,
  variant = "dock",
  autoFocus = false,
}: {
  sessionId: string;
  variant?: "dock" | "hero";
  autoFocus?: boolean;
}): ReactElement {
  const { send, stop, live } = useStream();
  const { sessions, settings } = useApp();
  const [text, setText] = useState(() => sessionDrafts.get(sessionId)?.text ?? "");
  const [images, setImages] = useState<ChatImage[]>(() => sessionDrafts.get(sessionId)?.images ?? []);
  const [imageError, setImageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // When the composer is filled via "编辑提问" the original turn's log seq is
  // remembered so the resend rewinds to that turn first (truncate) and then
  // sends the edited text — edit replaces the turn, it does not duplicate it.
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [policy, setPolicy] = useState<PolicyLevel | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<CursorCompletion | null>(null);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [catalog, setCatalog] = useState<
    Array<{
      label: string;
      description?: string;
      token: string;
      kind: "slash" | "mention";
    }>
  >([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const policyRef = useRef<HTMLDivElement>(null);
  const fileGeneration = useRef(0);
  const fileQueue = useRef(Promise.resolve());
  const completionValue = useRef({ text, cursor: 0 });
  const busy = !!live.get(sessionId)?.busy;
  const model =
    sessions.find((row) => row.sessionId === sessionId)?.model ??
    settings?.model ??
    "默认模型";
  const coarsePointer = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches,
  )[0];
  const isHero = variant === "hero";

  useEffect(() => {
    let alive = true;
    setPolicy(null);
    void api
      .policy(sessionId)
      .then((result) => {
        if (alive) setPolicy(result.policy);
      })
      .catch(() => {
        if (alive) setPolicy(settings?.approvalPolicy ?? null);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, settings?.approvalPolicy]);
  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.commands(),
      api.skills(),
      api.agents(),
      api.mcpResources(),
    ]).then((results) => {
      if (!alive) return
      const commands = results[0].status === "fulfilled" ? results[0].value.commands : []
      const skills = results[1].status === "fulfilled" ? results[1].value.skills : []
      const agents = results[2].status === "fulfilled" ? results[2].value.agents : []
      const resources = results[3].status === "fulfilled" ? results[3].value : { byServer: {} }
      setCatalog([
        ...commands.map((x) => ({ label: x.name, description: x.description, token: `/${x.name} `, kind: "slash" as const })),
        ...skills.map((x) => ({ label: x.name, description: x.description, token: `@skill:${x.name} `, kind: "mention" as const })),
        ...agents.map((x) => ({ label: x.name, description: x.description, token: `@agent:${x.name} `, kind: "mention" as const })),
        ...Object.entries(resources.byServer).flatMap(([server, group]) => group.resources.map((x) => ({ label: x.name ?? x.uri, description: server, token: `@mcp:${server}/${x.uri} `, kind: "mention" as const }))),
      ])
    })
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const onFocus = (): void => taRef.current?.focus();
    window.addEventListener("nh-focus-composer", onFocus);
    return () => window.removeEventListener("nh-focus-composer", onFocus);
  }, []);
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => taRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  useEffect(() => {
    const onFill = (event: Event): void => {
      const detail = (event as CustomEvent<{ text?: string; seq?: number } | string>).detail;
      const value = typeof detail === "string" ? detail : detail?.text;
      if (!value) return;
      setText(value);
      setEditingSeq(typeof detail === "string" ? null : (detail?.seq ?? null));
      sessionDrafts.set(sessionId, { text: value, images });
      requestAnimationFrame(() => taRef.current?.focus());
    };
    window.addEventListener("nh-fill-prompt", onFill);
    return () => window.removeEventListener("nh-fill-prompt", onFill);
  }, [sessionId]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.max(48, Math.min(220, ta.scrollHeight))}px`;
  }, [text]);
  useEffect(() => {
    setText(sessionDrafts.get(sessionId)?.text ?? "");
    setImages(sessionDrafts.get(sessionId)?.images ?? []);
    setError(null);
  }, [sessionId]);
  useEffect(() => {
    if (!policyOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (!policyRef.current?.contains(event.target as Node))
        setPolicyOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [policyOpen]);

  const updateText = (
    value: string,
    cursor = taRef.current?.selectionStart ?? value.length,
  ): void => {
    setText(value);
    // sessionDrafts 的 images 用函数式读取最新的，避免闭包旧值把刚导入的图片覆盖掉（切路由回来丢图）
    setImages((latest) => {
      sessionDrafts.set(sessionId, { text: value, images: latest });
      return latest;
    });
    const target = cursorCompletion(value, cursor);
    setCompletion(target);
    setCompletionIndex(0);
  };
  const chooseCompletion = (entry: (typeof catalog)[number]): void => {
    if (!completion) return;
    const next = replaceCompletion(text, completion, entry.token);
    updateText(next.value, next.cursor);
    setCompletion(null);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const generation = ++fileGeneration.current;
    fileQueue.current = fileQueue.current.then(async () => {
      if (generation !== fileGeneration.current) return;
      const incoming = Array.from(files);
      const current = sessionDrafts.get(sessionId)?.images ?? images;
      if (current.length + incoming.length > MAX_IMAGES) {
        setImageError("最多添加 5 张图片");
        return;
      }
      const next: ChatImage[] = [];
      let totalBytes = current.reduce((sum, image) => sum + Math.floor(image.data.length * 3 / 4), 0);
      for (const file of incoming) {
        if (generation !== fileGeneration.current) return;
        const mime = await sniffImageMime(file);
        if (!IMAGE_TYPES.has(mime)) { setImageError("仅支持 PNG、JPEG、WebP、GIF"); continue; }
        if (file.size > MAX_IMAGE_BYTES || totalBytes + file.size > MAX_IMAGE_TOTAL) { setImageError("图片大小超出限制"); continue; }
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(new Error("读取图片失败"));
          reader.readAsDataURL(file);
        });
        if (generation !== fileGeneration.current) return;
        next.push({ mime, data });
        totalBytes += file.size;
      }
      if (!next.length) return;
      setImages((value) => {
        const merged = [...value, ...next];
        // 同步 sessionDrafts：添加图片后切路由或输入文字时，
        // 避免 sessionDrafts 里的旧 images 把刚导入的图片覆盖掉。
        sessionDrafts.set(sessionId, { text: text, images: merged });
        return merged;
      });
      setImageError(null);
    }).catch((err) => setImageError(err instanceof Error ? err.message : "读取图片失败"));
    await fileQueue.current;
  };
  const choosePolicy = async (next: PolicyLevel): Promise<void> => {
    setPolicyOpen(false);
    if (next === policy || policyBusy) return;
    const previous = policy;
    setPolicy(next);
    setPolicyBusy(true);
    setPolicyError(null);
    try {
      await api.setPolicy(sessionId, next);
    } catch (err) {
      setPolicy(previous);
      setPolicyError(err instanceof Error ? err.message : "策略更新失败");
    } finally {
      setPolicyBusy(false);
    }
  };
  const doSend = useCallback(async (): Promise<void> => {
    const body = text.trim();
    const originalText = text;
    const originalImages = images;
    const rewriteSeq = editingSeq; // capture BEFORE reset (edit-to-rewind)
    if ((!body && images.length === 0) || sending) return;
    setSending(true);
    setText("");
    setImages([]);
    setEditingSeq(null);
    sessionDrafts.delete(sessionId);
    setError(null);
    try {
      // Active toolset: a single-line "/name args" is a SLASH COMMAND. Run it
      // through the session's command seam and send its expansion (the model
      // sees the command's result, not the raw "/name"). A multi-line body, an
      // image, or a non-command falls through to a normal prompt.
      let prompt = body;
      if (originalImages.length === 0 && !body.includes("\n") && body.startsWith("/")) {
        // Slash command: run it and send the expansion.
        try {
          const out = await api.runCommand(sessionId, body);
          if (typeof out.output === "string" && out.output.trim()) {
            prompt = out.output.trim();
          }
        } catch {
          // Unknown command / expansion failure — send the original text.
        }
      } else if (originalImages.length === 0 && /@(agent|skill|mcp):/.test(body)) {
        // @ reference: inline the referenced content so the model sees real
        // material (agent body / skill body / mcp resource) instead of a token.
        try {
          const out = await api.resolveReferences(sessionId, body);
          if (typeof out.expanded === "string" && out.expanded.trim()) {
            prompt = out.expanded.trim();
          }
        } catch {
          // Resolution unavailable — send the original text with the raw refs.
        }
      }
      // 改写语义：编辑的消息先回退到该 turn 之前（truncate seq-1 删除这条
      // 用户消息本身及其后所有历史），再发送新文本 —— 不是追加重复回合。
      if (rewriteSeq !== null) {
        try {
          await api.truncateSession(sessionId, rewriteSeq - 1);
        } catch (err) {
          setText(originalText);
          setImages(originalImages);
          sessionDrafts.set(sessionId, { text: originalText, images: originalImages });
          setError(err instanceof Error ? `改写失败 ${err.message}` : "改写失败，内容已保留");
          return;
        }
      }
      const ok = await send(sessionId, prompt, originalImages);
      if (ok === false) {
        setText(originalText);
        setImages(originalImages);
        sessionDrafts.set(sessionId, { text: originalText, images: originalImages });
        setError("发送失败，内容已保留，请重试");
      }
    } catch (err) {
      setText(originalText);
      setImages(originalImages);
      sessionDrafts.set(sessionId, { text: originalText, images: originalImages });
      setError(err instanceof Error ? err.message : "发送失败，内容已保留，请重试");
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  }, [images, send, sessionId, sending, text]);
  const options = completion
    ? catalog
        .filter(
          (entry) =>
            entry.kind === completion.kind &&
            `${entry.label} ${entry.description ?? ""}`
              .toLowerCase()
              .includes(completion.query.toLowerCase()),
        )
        .slice(0, 8)
    : [];

  return (
    <div
      className={
        isHero
          ? "w-full"
          : "flex-none px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))] pt-2 sm:px-6 lg:px-8"
      }
    >
      <div
        className={
          isHero ? "mx-auto w-full max-w-2xl" : "mx-auto w-full max-w-[880px]"
        }
      >
        {(error || imageError || policyError) && (
          <div className="composer-error">
            {error ?? imageError ?? `策略未更新：${policyError}`}
          </div>
        )}
        <div
          className={`composer-commandbar ${isHero ? "composer-commandbar-hero" : ""}`}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              void addFiles(files);
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void addFiles(event.dataTransfer.files);
          }}
        >
          <div className="composer-attachments">
            {images.map((image, index) => (
              <span
                key={`${image.mime}-${index}`}
                className="composer-attachment"
              >
                <img
                  src={`data:${image.mime};base64,${image.data}`}
                  alt={`附件 ${index + 1}`}
                />
                <button
                  type="button"
                  aria-label={`移除附件 ${index + 1}`}
                  onClick={() =>
                    setImages((value) =>
                      value.filter((_, current) => current !== index),
                    )
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <textarea
            ref={taRef}
            value={text}
            rows={isHero ? 2 : 1}
            placeholder={
              busy
                ? "继续告诉 agent 下一步…"
                : "向 newhorse 提问，或描述要完成的工作…"
            }
            onChange={(event) => updateText(event.target.value)}
            onSelect={() => updateText(taRef.current?.value ?? "", taRef.current?.selectionStart ?? 0)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (
                completion && options.length > 0 &&
                (event.key === "ArrowDown" ||
                  event.key === "ArrowUp" ||
                  event.key === "Enter" ||
                  event.key === "Tab" ||
                  event.key === "Escape")
              ) {
                event.preventDefault();
                if (event.key === "Escape") setCompletion(null);
                else if (event.key === "ArrowDown") setCompletionIndex((value) => Math.min(options.length - 1, value + 1));
                else if (event.key === "ArrowUp") setCompletionIndex((value) => Math.max(0, value - 1));
                else if (event.key === "Enter" || event.key === "Tab") {
                  const option = options[completionIndex];
                  if (option) chooseCompletion(option);
                } else setCompletion(null);
                return;
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !coarsePointer
              ) {
                event.preventDefault();
                void doSend();
              }
            }}
            className="composer-textarea"
            aria-label="输入任务"
          />
          {completion && options.length > 0 && (
            <div
              className="composer-completion"
              role="listbox"
              aria-label={completion.kind === "slash" ? "命令补全" : "资源引用补全"}
              aria-activedescendant={`composer-option-${completionIndex}`}
            >
              {options.map((entry, index) => (
                <button
                  id={`composer-option-${index}`}
                  aria-selected={index === completionIndex}
                  key={`${entry.kind}:${entry.label}`}
                  type="button"
                  role="option"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    chooseCompletion(entry);
                  }}
                >
                  <strong>
                    {completion.kind === "slash" ? "/" : "@"}
                    {entry.label}
                  </strong>
                  <small>{entry.description}</small>
                </button>
              ))}
            </div>
          )}
          <div className="composer-toolbar">
            <div className="composer-toolbar-left">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="icon-btn composer-attach"
                aria-label="添加图片"
                title="添加图片"
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus size={15} />
              </button>
              <div ref={policyRef} className="relative">
                <button
                  type="button"
                  className={`policy-trigger ${policyOpen ? "is-open" : ""}`}
                  aria-haspopup="listbox"
                  aria-expanded={policyOpen}
                  onClick={() => setPolicyOpen((value) => !value)}
                  disabled={policyBusy}
                >
                  <ShieldCheck size={13} />
                  <span>{policyBusy ? "更新中…" : policyLabel(policy)}</span>
                  <ChevronDown size={12} />
                </button>
                {policyOpen && (
                  <div
                    className="policy-menu"
                    role="listbox"
                    aria-label="审批策略"
                  >
                    <div className="policy-menu-heading">当前 session 权限</div>
                    {POLICY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={policy === option.value}
                        className={`policy-option ${policy === option.value ? "is-selected" : ""}`}
                        onClick={() => void choosePolicy(option.value)}
                      >
                        <span className="min-w-0 flex-1">
                          <strong>{option.label}</strong>
                          <small>{option.hint}</small>
                        </span>
                        {policy === option.value && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="composer-scope">
                <span className="composer-scope-dot" />
                {busy ? "插话中 · 发送即插入当前回合" : "准备就绪"}
              </span>
            </div>
            <div className="composer-toolbar-right">
              <span className="composer-model" title="当前模型">
                {model}
              </span>
              {busy ? (
                <button
                  type="button"
                  className="composer-stop"
                  aria-label="中断当前回合"
                  onClick={() =>
                    void stop(sessionId, live.get(sessionId)?.startedAt)
                  }
                >
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className={`composer-send ${text.trim() || images.length ? "has-text" : ""}`}
                  aria-label="发送任务"
                  disabled={sending || (!text.trim() && images.length === 0)}
                  onClick={() => void doSend()}
                >
                  {sending ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <ArrowUp size={15} />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
        {isHero && (
          <p className="composer-hint">
            Enter 发送 · Shift+Enter 换行 · 当前策略由 session 持久化
          </p>
        )}
      </div>
    </div>
  );
}
