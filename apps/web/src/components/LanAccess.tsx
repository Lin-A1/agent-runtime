import { useCallback, useEffect, useState, type ReactElement } from "react"
import { Check, Copy, QrCode, X } from "lucide-react"
import QRCode from "qrcode"
import { api } from "../api/client"

/**
 * 手机连接（LAN access）：侧边栏底部一个小手机图标，点击弹出居中弹窗。
 * 弹窗展示：
 *   · 二维码 —— 扫码直接打开带 token 的连接链接（打开即自动填入）
 *   · 局域网地址 + 访问令牌（自动生成，用户无需翻配置文件）
 *   · 复制令牌按钮（备用）
 * Token 只从 loopback-only 的 GET /v1/token 取；远程设备永远拿不到。
 */
export function LanAccess(): ReactElement {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [lanUrl, setLanUrl] = useState("")
  const [loaded, setLoaded] = useState(false)

  const load = useCallback((): void => {
    void Promise.all([api.lanToken(), api.network().catch(() => null)])
      .then(([tr, nr]) => {
        const t = tr.token ?? null
        setToken(t)
        // The phone URL uses the machine's LAN IP (not the page host, which is
        // 127.0.0.1 when browsing locally) + the server port. QR + share link
        // must carry the LAN host too — a 127.0.0.1 link would point at the
        // phone itself.
        const host = String(nr?.lanIp ?? window.location.hostname)
        const port = String(nr?.port ?? window.location.port ?? 3927)
        setLanUrl(`http://${host}:${port}`)
        setLoaded(true)
        if (t) {
          const link = `http://${host}:${port}/?token=${t}`
          void QRCode.toDataURL(link, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(null))
        }
      })
      .catch(() => {
        setToken(null)
        setLoaded(true)
      })
  }, [])

  useEffect(() => {
    if (!open) return
    setQr(null)
    load()
  }, [open, load])

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const shareLink = token && lanUrl ? `${lanUrl}/?token=${token}` : null

  // 手机/远程设备自己访问时不需要「手机访问」入口（二维码是给电脑端
  // 展示、让手机扫的——手机已在这台机器上，显示它毫无意义）。
  // 页面 host 是 loopback 才显示：127.0.0.1 / localhost / ::1。
  const hostname = window.location.hostname
  const isLocal =
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === ""

  if (!isLocal) return <></>

  return (
    <>
      {/* 左下角小手机图标按钮 */}
      <button
        type="button"
        className="flex h-8 items-center justify-between rounded-lg px-2.5 text-left text-xs text-dim transition-colors select-none hover:bg-hover-2 hover:text-ink"
        title="手机访问"
        onClick={() => setOpen(true)}
      >
        <span className="flex items-center gap-2">
          <QrCode size={13} className="text-dim" />
          <span>手机访问</span>
        </span>
        <span className="font-mono text-2xs text-faint">扫码</span>
      </button>

      {/* 居中弹窗 */}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-xs rounded-2xl border border-line bg-panel p-5 shadow-overlay"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="手机连接"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-fg">手机连接</span>
              <button type="button" className="icon-btn !h-6 !w-6" aria-label="关闭手机连接" onClick={() => setOpen(false)}>
                <X size={13} />
              </button>
            </div>

            {!loaded ? (
              <div className="py-8 text-center text-2xs text-faint">加载中…</div>
            ) : token ? (
              <div className="flex flex-col items-center gap-3">
                {qr ? (
                  <div className="rounded-lg border border-line bg-white p-2">
                    <img src={qr} alt="手机连接二维码" className="h-44 w-44" />
                  </div>
                ) : (
                  <div className="h-44 w-44 animate-pulse rounded-lg bg-field" />
                )}
                <div className="w-full text-center">
                  <div className="text-2xs text-faint">手机连同一 Wi-Fi，扫码打开（令牌自动填入）</div>
                  {/* 链接 + 令牌合并：一处复制即可 */}
                  <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-bg2 px-2 py-2">
                    <code className="min-w-0 flex-1 truncate text-left font-mono text-[11px] leading-snug text-fg">
                      {shareLink}
                    </code>
                    <button
                      type="button"
                      className="icon-btn !h-7 !w-7 flex-none"
                      aria-label="复制连接信息"
                      title="复制连接信息（链接+令牌）"
                      onClick={() => copy(shareLink ?? "")}
                    >
                      {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
                    </button>
                  </div>
                  <div className="mt-2 text-2xs text-faint">未自动连接时：地址 <code className="font-mono">{lanUrl}</code>，令牌见上方</div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-2xs text-faint">
                未配置令牌——仅本机可访问。
                <br />
                重启服务后自动生成，即可扫码连接手机。
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
