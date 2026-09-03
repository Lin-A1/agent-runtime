/**
 * Remote-access dialog (pre-review #41 / webRemoteControl UX): one link that
 * adapts to the device — a phone scans the QR to open the mobile web, a
 * computer copies the link. The QR is generated locally (zero engine
 * endpoints); the host is 0.0.0.0 LAN guidance lives in settings. The same
 * responsive build serves both (desktop full rails, mobile a drawer/sheet).
 */
import { useEffect, useState } from "react"
import { Check, Copy, KeyRound, Link2, QrCode, Smartphone } from "lucide-react"
import qrcode from "qrcode-generator"
import { baseUrl, setConnection, token as readToken } from "../api/client"
import { Modal } from "./ui"

export function RemoteAccess({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [href, setHref] = useState("")
  const [qr, setQr] = useState("")
  // Connection section: the token the REMOTE device will use. Prefilled from
  // localStorage (this browser's stored token); saving writes it there and
  // rebuilds the share link. The link carries ?token= only when the user
  // opts in (LAN-only caveat — the token lands in browser history).
  const [tok, setTok] = useState("")
  const [carryToken, setCarryToken] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    setTok(readToken())
    setCarryToken(false)
    setSaved(false)
    setCopied(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const base = baseUrl()
    const url = carryToken && tok ? `${base}/?token=${encodeURIComponent(tok)}#/` : `${base}/`
    setHref(url)
    const q = qrcode(0, "M")
    q.addData(url)
    q.make()
    // Force a size and paint the dark modules currentColor so the QR renders
    // crisply on the white card regardless of theme.
    const svg = q
      .createSvgTag({ cellSize: 4, margin: 2 })
      .replace("<svg ", '<svg width="188" height="188" style="display:block;color:#111111" ')
    setQr(svg)
  }, [open, tok, carryToken])

  const copy = (): void => {
    void navigator.clipboard?.writeText(href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  const saveConn = (): void => {
    setConnection(baseUrl(), tok.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <Modal open={open} onClose={onClose} title="手机 / 其他设备访问" width={440}>
      <div className="flex flex-col items-center">
        <div className="mb-1 flex items-center gap-2 self-start text-2xs text-faint">
          <Smartphone size={13} /> 手机扫码进入手机端；电脑复制链接即可在浏览器远程控制（同一页面，自动适配端）
        </div>

        <div
          className="mt-3 rounded-2xl border border-line bg-white p-3"
          // qrcode-generator emits a self-contained <svg>; safe static markup.
          dangerouslySetInnerHTML={{ __html: qr }}
        />

        <div className="mt-4 flex w-full items-center gap-2 rounded-xl border border-line bg-bg2 px-3 py-2">
          <Link2 size={14} className="flex-none text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-dim">{href || "…"}</span>
          <button className="btn !py-1 text-2xs" onClick={copy}>
            {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>

        {/* connection: token entry — the remote device needs it once the
            engine has NEWHORSE_TOKEN set (static shell loads open; /v1 gated) */}
        <div className="mt-3 w-full rounded-xl border border-line bg-bg2 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-2xs font-medium text-dim">
            <KeyRound size={12} /> 访问令牌（引擎设置了 token 时必填）
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input !py-1.5 flex-1 font-mono text-2xs"
              type="password"
              placeholder="粘贴访问令牌（保存在本机浏览器）"
              value={tok}
              onChange={(e) => setTok(e.target.value)}
            />
            <button className="btn !py-1.5 text-2xs" onClick={saveConn}>
              {saved ? <Check size={12} className="text-ok" /> : null}
              {saved ? "已保存" : "保存"}
            </button>
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-2xs text-faint">
            <input type="checkbox" checked={carryToken} onChange={(e) => setCarryToken(e.target.checked)} />
            链接携带令牌（仅局域网使用——令牌会进入对方浏览器历史）
          </label>
        </div>

        <p className="mt-3 flex items-start gap-2 rounded-xl bg-bg2 p-2.5 text-2xs leading-relaxed text-faint">
          <QrCode size={13} className="mt-0.5 flex-none text-warn" />
          手机访问需要引擎监听 <code className="font-mono">0.0.0.0</code>。引擎设了访问令牌时，API 全走 Bearer——页面可裸开，但数据接口要令牌。同一路由在手机上会收窄为单列、侧栏变抽屉。
        </p>
      </div>
    </Modal>
  )
}
