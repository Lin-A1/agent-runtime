import { useCallback, useEffect, useState, type ReactElement } from "react"
import { Check, Loader2, Plug, X } from "lucide-react"
import { api } from "../api/client"
import type { McpServerSettings, SettingsView } from "../api/types"

/**
 * MCP 工具开关面板：侧边栏底部一个「MCP」按钮 → 居中弹窗列出全部已配置
 * 的 MCP 服务器（名称/command/url/凭证状态），每个一个开关。切换时
 * PUT /v1/settings 持久化 mcpServers.<name>.enabled —— 用户无需翻
 * ~/.newhorse/config.json 就能开/关工具（重启服务后生效）。
 */
export function McpSettings(): ReactElement {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((): void => {
    void api
      .settings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const toggle = (name: string, enabled: boolean): void => {
    setBusy(name)
    setError(null)
    // The settings PUT treats mcpServers as the FULL desired set (an omitted
    // entry is removed) — submit the whole map with the toggled server's
    // enabled flipped. The redacted entries come back through settings().
    const next: Record<string, { enabled: boolean }> = {}
    for (const [k, v] of Object.entries(servers ?? {})) {
      next[k] = { enabled: k === name ? enabled : v.enabled === true }
    }
    void api
      .putSettings({ mcpServers: next } as never)
      .then((s) => {
        setSettings(s)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "保存失败"))
      .finally(() => setBusy(null))
  }

  const servers = settings?.mcpServers ?? {}

  return (
    <>
      <button
        type="button"
        className="flex h-8 items-center justify-between rounded-lg px-2.5 text-left text-xs text-dim transition-colors select-none hover:bg-hover-2 hover:text-ink"
        title="MCP 工具开关"
        onClick={() => setOpen(true)}
      >
        <span className="flex items-center gap-2">
          <Plug size={13} className="text-dim" />
          <span>MCP 工具</span>
        </span>
        <span className="font-mono text-2xs text-faint">开关</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-overlay"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="MCP 工具"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-fg">MCP 工具</span>
              <button type="button" className="icon-btn !h-6 !w-6" aria-label="关闭 MCP 工具" onClick={() => setOpen(false)}>
                <X size={13} />
              </button>
            </div>

            {Object.keys(servers).length === 0 ? (
              <div className="py-6 text-center text-2xs text-faint">暂无 MCP 服务器配置</div>
            ) : (
              <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
                {Object.entries(servers).map(([name, cfg]) => (
                  <div key={name} className="flex items-center gap-2 rounded-lg bg-bg2/60 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-fg">{name}</div>
                      <div className="truncate font-mono text-[10px] text-faint">
                        {cfg.url ?? cfg.command ?? "?"}
                        {cfg.hasEnv && " · 有 Key"}
                        {cfg.hasHeaders && " · 有 Header"}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={cfg.enabled === true}
                      aria-label={`${name} 开关`}
                      className={`relative h-5 w-9 flex-none rounded-full transition-colors ${
                        cfg.enabled === true ? "bg-accent" : "bg-hover-2"
                      }`}
                      disabled={busy === name}
                      onClick={() => toggle(name, cfg.enabled !== true)}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                          cfg.enabled === true ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                      {busy === name && <Loader2 size={12} className="absolute right-1 top-1.5 animate-spin" />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(saved || error) && (
              <div className={`mt-3 flex items-center gap-1.5 text-2xs ${error ? "text-bad" : "text-ok"}`}>
                {saved && !error && <><Check size={11} /> 已保存（重启服务后生效）</>}
                {error && error}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
