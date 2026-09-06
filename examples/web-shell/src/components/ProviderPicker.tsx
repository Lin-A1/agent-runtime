import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { Check, ChevronDown, Loader2, Pencil, Plus, Server, Trash2, X } from "lucide-react"
import { api } from "../api/client"
import type { ModelCatalog, ProvidersView } from "../api/types"
import { useApp } from "../state/store"

/**
 * Model manager (adapted-provider configuration, not just a picker):
 *  - activate a provider + model (settings.activeProviderId + model);
 *  - edit a profile's baseUrl / apiKey / model / budgets (settings.providers
 *    upsert — an empty apiKey keeps the stored secret, per the settings-API
 *    redaction contract);
 *  - add a new provider profile; remove one (providersRemove).
 * Visual language (spinner dots, dense rows) adapted from the galaxy
 * collection's loader/menu patterns (G:/temp/galaxy, MIT).
 */

interface DraftProfile {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  model: string
  contextWindowTokens: string
  maxOutputTokens: string
}

// User-facing protocol choices. `openai` and `openai-compatible` are the SAME
// wire protocol (openaiProtocol + /v1/chat/completions — see llm/adapter.ts),
// so the picker shows one entry; `openai-compatible` remains accepted as a
// stored kind alias for existing profiles.
const PROVIDER_KINDS = ["openai", "openai-responses", "anthropic"] as const

function emptyDraft(): DraftProfile {
  return { id: "", name: "", kind: "openai", baseUrl: "", apiKey: "", model: "", contextWindowTokens: "", maxOutputTokens: "" }
}

export function ProviderPicker(): ReactElement {
  const { settings, switchProvider, refreshSettings } = useApp()
  const [providersView, setProvidersView] = useState<ProvidersView | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProfile>(emptyDraft())
  const [adding, setAdding] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const reloadSurfaces = useCallback(async (): Promise<void> => {
    const [p, c] = await Promise.allSettled([api.providers(), api.catalog()])
    if (p.status === "fulfilled") setProvidersView(p.value)
    if (c.status === "fulfilled") setCatalog(c.value)
  }, [])

  useEffect(() => {
    void reloadSurfaces()
  }, [open, reloadSurfaces])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const catalogProviders = catalog?.providers ?? []
  const activeProviderId = settings?.activeProviderId ?? providersView?.activeProviderId ?? ""
  const providerRows = useMemo(() => {
    if (providersView?.providers.length) return providersView.providers
    // Single-provider setups expose the effective provider without a profile —
    // synthesize a row so models can still be listed and activated.
    if (providersView?.provider) {
      return [{ id: activeProviderId || String(providersView.provider.kind), name: String(providersView.provider.kind), kind: String(providersView.provider.kind), baseUrl: providersView.provider.baseUrl ?? "", hasApiKey: providersView.provider.hasApiKey, model: undefined, contextWindowTokens: undefined, maxOutputTokens: undefined }]
    }
    return []
  }, [providersView, activeProviderId])
  const activeModel = settings?.model ?? providersView?.model ?? "—"
  const activeProviderName = useMemo(
    () => catalogProviders.find((p) => p.id === activeProviderId)?.name ?? providerRows.find((p) => p.id === activeProviderId)?.name ?? activeProviderId ?? "默认",
    [activeProviderId, catalogProviders, providerRows],
  )

  const startEdit = (id: string): void => {
    const row = providerRows.find((p) => p.id === id)
    setAdding(false)
    setEditingId(id)
    setDraft({
      id,
      name: row?.name ?? id,
      kind: row?.kind ?? "openai-compatible",
      baseUrl: row?.baseUrl ?? "",
      apiKey: "",
      model: row?.model ?? "",
      contextWindowTokens: row && "contextWindowTokens" in row && row.contextWindowTokens != null ? String(row.contextWindowTokens) : "",
      maxOutputTokens: row && "maxOutputTokens" in row && row.maxOutputTokens != null ? String(row.maxOutputTokens) : "",
    })
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft.id.trim()) {
      setError("提供方 id 不能为空")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const profile: Record<string, unknown> = {
        id: draft.id.trim(),
        name: draft.name.trim() || draft.id.trim(),
        kind: draft.kind,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        ...(draft.contextWindowTokens.trim() && Number.isFinite(Number(draft.contextWindowTokens)) ? { contextWindowTokens: Number(draft.contextWindowTokens) } : {}),
        ...(draft.maxOutputTokens.trim() && Number.isFinite(Number(draft.maxOutputTokens)) ? { maxOutputTokens: Number(draft.maxOutputTokens) } : {}),
      }
      // Settings upsert by id; an empty apiKey KEEPS the stored secret.
      await api.putSettings({ providers: [profile], ...(adding ? { activeProviderId: profile.id } : {}) })
      await refreshSettings()
      await reloadSurfaces()
      setEditingId(null)
      setAdding(false)
      setDraft(emptyDraft())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const removeProvider = async (id: string): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await api.putSettings({ providersRemove: [id] } as never)
      await refreshSettings()
      await reloadSurfaces()
      if (editingId === id) {
        setEditingId(null)
        setDraft(emptyDraft())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const pick = async (providerId: string, model: string): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      // Global default (new sessions) AND the OPEN session switch together —
      // a model choice that only affects future sessions looks broken in the
      // composer label. The transcript listens and applies it per-session.
      await switchProvider(providerId, model)
      window.dispatchEvent(new CustomEvent("nh-apply-session-model", { detail: model }))
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const renderDraftForm = (): ReactElement => (
    <div className="model-config-form">
      <div className="model-config-form-title">{adding ? "新增提供方" : `配置 ${draft.id}`}</div>
      {adding && <label className="model-config-field"><span>id</span><input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="my-gateway" spellCheck={false} /></label>}
      <label className="model-config-field"><span>名称</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="显示名称" spellCheck={false} /></label>
      <label className="model-config-field"><span>协议</span><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{PROVIDER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
      <label className="model-config-field"><span>Base URL</span><input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} /></label>
      <label className="model-config-field"><span>API Key</span><input type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder={providerRows.find((p) => p.id === draft.id)?.hasApiKey ? "已配置（留空保留）" : "sk-…"} spellCheck={false} autoComplete="off" /></label>
      <label className="model-config-field"><span>默认模型</span><input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="model-id" spellCheck={false} /></label>
      <div className="model-config-field-row">
        <label className="model-config-field"><span>窗口 tokens</span><input value={draft.contextWindowTokens} onChange={(e) => setDraft({ ...draft, contextWindowTokens: e.target.value })} placeholder="1000000" inputMode="numeric" /></label>
        <label className="model-config-field"><span>输出上限</span><input value={draft.maxOutputTokens} onChange={(e) => setDraft({ ...draft, maxOutputTokens: e.target.value })} placeholder="8192" inputMode="numeric" /></label>
      </div>
      <div className="model-config-actions">
        <button type="button" className="model-config-btn" disabled={saving} onClick={() => { setEditingId(null); setAdding(false); setDraft(emptyDraft()) }}>取消</button>
        <button type="button" className="model-config-btn is-primary" disabled={saving || !draft.id.trim()} onClick={() => void saveDraft()}>{saving ? <Loader2 size={11} className="spin" /> : "保存"}</button>
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-dim transition-colors select-none hover:bg-hover-2 hover:text-ink"
        title="模型 / 提供方配置"
      >
        <Server size={13} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate">{activeModel}</span>
        <span className="shrink-0 font-mono text-[10px] text-faint">@{activeProviderName}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[70] mb-1.5 w-80 overflow-hidden rounded-lg border border-line bg-panel shadow-overlay">
          <div className="border-b border-line px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-faint">模型 / 提供方</div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {providerRows.map((provider) => {
              const models = catalogProviders.find((p) => p.id === provider.id)?.models ?? []
              const isActive = provider.id === activeProviderId
              if (editingId === provider.id) return <div key={provider.id} className="mb-1">{renderDraftForm()}</div>
              return (
                <div key={provider.id} className="mb-1 rounded-md border border-transparent px-1 py-0.5 hover:border-line">
                  <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-ink">
                    <Server size={12} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">{provider.name ?? provider.id}</span>
                    {provider.hasApiKey === false && <span className="flex-none rounded bg-warn/15 px-1 text-2xs text-warn">未配 key</span>}
                    <button type="button" className="icon-btn !h-5 !w-5 text-ghost hover:text-dim" title="配置" onClick={() => startEdit(provider.id)}><Pencil size={11} /></button>
                    <button type="button" className="icon-btn !h-5 !w-5 text-ghost hover:text-bad" title="删除提供方" disabled={saving} onClick={() => void removeProvider(provider.id)}><Trash2 size={11} /></button>
                    {isActive && <Check size={12} className="shrink-0 text-ok" />}
                  </div>
                  <div className="ml-4 flex flex-col gap-0.5">
                    {models.length ? models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={saving}
                        onClick={() => void pick(provider.id, m.id)}
                        className={`flex items-center justify-between rounded-md px-2 py-1 text-left text-2xs transition-colors select-none hover:bg-hover-2 ${isActive && m.id === activeModel ? "text-accent" : "text-dim"}`}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">{m.name ?? m.id}</span>
                        {isActive && m.id === activeModel && <Check size={11} className="shrink-0 text-ok" />}
                      </button>
                    )) : provider.model ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void pick(provider.id, provider.model!)}
                        className={`flex items-center justify-between rounded-md px-2 py-1 text-left text-2xs transition-colors select-none hover:bg-hover-2 ${isActive && provider.model === activeModel ? "text-accent" : "text-dim"}`}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">{provider.model}</span>
                        {isActive && provider.model === activeModel && <Check size={11} className="shrink-0 text-ok" />}
                      </button>
                    ) : (
                      <span className="px-2 py-1 text-2xs text-faint">{provider.hasApiKey === false ? "配置 API Key 后可发现模型" : "目录中无该提供方模型 — 可在配置里填默认模型"}</span>
                    )}
                  </div>
                </div>
              )
            })}
            {editingId === null || !providerRows.some((p) => p.id === editingId) ? null : null}
            {adding && renderDraftForm()}
            {providerRows.length === 0 && !adding && (
              <div className="px-3 py-4 text-center text-2xs text-faint">{saving ? <Loader2 size={13} className="spin mx-auto" /> : "还没有配置任何提供方"}</div>
            )}
          </div>
          {!adding && editingId === null && (
            <div className="border-t border-line p-1.5">
              <button type="button" className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-2xs text-dim transition-colors select-none hover:bg-hover-2 hover:text-ink" disabled={saving} onClick={() => { setAdding(true); setEditingId(null); setDraft(emptyDraft()) }}><Plus size={12} />新增提供方</button>
            </div>
          )}
          {error && <div className="flex items-center justify-between border-t border-line px-3 py-2 text-2xs text-warn"><span className="min-w-0 truncate">{error}</span><button type="button" aria-label="关闭错误" onClick={() => setError(null)}><X size={11} /></button></div>}
        </div>
      )}
    </div>
  )
}
