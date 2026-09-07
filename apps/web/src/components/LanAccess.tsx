import { useCallback, useEffect, useState, type ReactElement } from "react"
import { Check, Copy, QrCode, Smartphone, X } from "lucide-react"
import { api } from "../api/client"

/**
 * LAN access helper (手机端连接): the token is minted server-side on first
 * boot when binding non-loopback — the user should never have to grep
 * ~/.newhorse/config.json for it. This panel fetches the token from the
 * loopback-only GET /v1/token, shows the phone URL, and offers one-tap copy
 * (plus the ?token= share-link form the app already understands).
 */
export function LanAccess(): ReactElement {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [lanUrl, setLanUrl] = useState("")

  const refresh = useCallback((): void => {
    void api
      .lanToken()
      .then((r) => {
        setToken(r.token ?? null)
        const loc = window.location
        setLanUrl(`http://${loc.hostname}:${loc.port || 3927}`)
      })
      .catch(() => setToken(null))
  }, [])

  useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!open) {
    return (
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-dim transition-colors select-none hover:bg-hover-2 hover:text-ink"
        onClick={() => setOpen(true)}
      >
        <Smartphone size={13} className="text-dim" />
        <span>手机访问</span>
        <span className="ml-auto font-mono text-2xs text-faint">局域网</span>
      </button>
    )
  }

  const shareLink = token ? `${window.location.origin}/?token=${token}` : null

  return (
    <div className="mb-1 rounded-lg border border-line bg-field/60 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-2xs font-medium text-fg">
          <Smartphone size={11} className="text-accent" /> 手机连接
        </span>
        <button type="button" className="icon-btn !h-5 !w-5" aria-label="关闭手机访问" onClick={() => setOpen(false)}>
          <X size={11} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 text-2xs">
        <div>
          <div className="mb-0.5 text-faint">1. 手机连同一 Wi-Fi，浏览器打开</div>
          <code className="block truncate rounded bg-bg2 px-1.5 py-0.5 font-mono text-[11px] text-fg">{lanUrl || "http://<电脑IP>:3927"}</code>
        </div>
        {token && (
          <>
            <div>
              <div className="mb-0.5 text-faint">2. 输入访问令牌（自动生成，无需翻文件）</div>
              <div className="flex items-center gap-1 rounded bg-bg2 px-1.5 py-0.5 font-mono text-[11px] text-fg">
                <span className="min-w-0 flex-1 truncate">{token}</span>
                <button
                  type="button"
                  className="icon-btn !h-5 !w-5"
                  aria-label="复制令牌"
                  title="复制令牌"
                  onClick={() => copy(token)}
                >
                  {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
                </button>
              </div>
            </div>
            {shareLink && (
              <>
                <div className="mb-0.5 text-faint">或：复制带令牌的链接发到手机（自动填入）</div>
                <div className="flex items-center gap-1 rounded bg-bg2 px-1.5 py-0.5 font-mono text-[11px] text-fg">
                  <span className="min-w-0 flex-1 truncate">{shareLink}</span>
                  <button
                    type="button"
                    className="icon-btn !h-5 !w-5"
                    aria-label="复制链接"
                    title="复制链接"
                    onClick={() => copy(shareLink)}
                  >
                    {copied ? <Check size={11} className="text-ok" /> : <QrCode size={11} />}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {!token && <div className="text-faint">未配置令牌 —— 仅本机可访问；在命令行重启服务后会自动生成。</div>}
      </div>
    </div>
  )
}
