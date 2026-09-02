/**
 * Settings — single page with a left nav (opencode organization) and four
 * sections. Models & providers follows cc-switch: preset cards with one-click
 * atomic switch (activeProviderId), redacted key presence (留空=保持),
 * clearable fields, model list with catalog enhancement (#37). Integration
 * section carries MCP servers (hasEnv/hasHeaders presence) and inbound
 * channels (hasSecret, test-via-inbound). All shapes = SettingsView.
 */
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import {
  BarChart3,
  Boxes,
  CalendarClock,
  Check,
  Cpu,
  DownloadCloud,
  GitBranch,
  Inbox,
  KeyRound,
  Trash2,
  Link2,
  Network,
  Plus,
  Plug,
  RefreshCw,
  Send,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Webhook,
  X,
} from "lucide-react"
import { api } from "../api/client"
import type { ChannelConfig, McpServerSettings, SettingsView } from "../api/types"
import { useApi } from "../lib/useApi"
import { AsyncRegion, EmptyState, Label, LoadingState, Modal, PageHeader, Segmented, Toggle } from "../components/ui"
import { UsagePage } from "./Usage"
import { MemoryPage } from "./Memory"
import { SchedulesPage } from "./Schedules"
import { DagsPage } from "./Dags"
import { SkillsPage } from "./Skills"
import { LivePage } from "./Live"

type ConfigSection = "models" | "integrations" | "behavior" | "system"
type HubSection = "usage" | "schedules" | "dags" | "skills" | "memory" | "live"
type Section = ConfigSection | HubSection

const CONFIG_NAV: Array<{ id: ConfigSection; label: string; icon: React.ReactNode }> = [
  { id: "models", label: "模型与供应商", icon: <Cpu size={14} /> },
  { id: "integrations", label: "集成", icon: <Plug size={14} /> },
  { id: "behavior", label: "行为", icon: <SlidersHorizontal size={14} /> },
  { id: "system", label: "系统", icon: <Settings2 size={14} /> },
]

// Secondary surfaces live inside the settings hub (the sidebar stays minimal).
const HUB_NAV: Array<{ id: HubSection; label: string; icon: React.ReactNode }> = [
  { id: "usage", label: "用量分析", icon: <BarChart3 size={14} /> },
  { id: "schedules", label: "定时任务", icon: <CalendarClock size={14} /> },
  { id: "dags", label: "编排", icon: <GitBranch size={14} /> },
  { id: "skills", label: "技能", icon: <Sparkles size={14} /> },
  { id: "memory", label: "记忆", icon: <Inbox size={14} /> },
  { id: "live", label: "运行状态", icon: <Network size={14} /> },
]

const HUB_PAGES: Record<HubSection, () => React.ReactElement> = {
  usage: UsagePage,
  schedules: SchedulesPage,
  dags: DagsPage,
  skills: SkillsPage,
  memory: MemoryPage,
  live: LivePage,
}

const HUB_IDS: HubSection[] = ["usage", "schedules", "dags", "skills", "memory", "live"]
const CONFIG_IDS: ConfigSection[] = ["models", "integrations", "behavior", "system"]

export function SettingsPage({ initial }: { initial?: Section } = {}): React.ReactElement {
  const { section: routeSection } = useParams()
  const start: Section = (initial ??
    (routeSection && (HUB_IDS.includes(routeSection as HubSection) || CONFIG_IDS.includes(routeSection as ConfigSection)) ? routeSection : "models")) as Section
  const [section, setSection] = useState<Section>(start)
  const settings = useApi<SettingsView>(() => api.settings(), [])
  // PUT 深合并（密钥留空 = 保持不变），成功后重拉生效视图。返回成功与否，
  // 供乐观切换的控件在失败时回滚。
  const putPatch = (patch: unknown): Promise<boolean> =>
    api.putSettings(patch).then(() => {
      settings.retry()
      return true
    }).catch((e) => {
      window.alert("保存失败：" + (e instanceof Error ? e.message : String(e)))
      return false
    })
  const isHub = (s: Section): s is HubSection => (["usage", "schedules", "dags", "skills", "memory", "live"] as string[]).includes(s)

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav className="z-20 flex-none border-b border-line bg-panel p-2 md:h-auto md:w-[228px] md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
        {/* 配置 group */}
        <div className="px-2 pb-1.5 pt-1 text-2xs font-medium uppercase tracking-wide text-ghost">配置</div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-x-hidden md:pb-0">
          {CONFIG_NAV.map((n) => (
            <NavButton key={n.id} active={section === n.id} icon={n.icon} label={n.label} onClick={() => setSection(n.id)} />
          ))}
        </div>
        {/* 数据与能力 group — its own row on mobile with visible breathing room */}
        <div className="mt-1 px-2 pb-1.5 pt-2 text-2xs font-medium uppercase tracking-wide text-ghost md:mt-2 md:border-t md:border-line md:pt-2.5">
          数据与能力
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-x-hidden md:pb-0">
          {HUB_NAV.map((n) => (
            <NavButton key={n.id} active={section === n.id} icon={n.icon} label={n.label} onClick={() => setSection(n.id)} />
          ))}
        </div>
      </nav>

      {isHub(section) ? (
        <div className="hub-embedded flex min-h-0 min-w-0 flex-1 flex-col">{(() => { const P = HUB_PAGES[section]; return <P /> })()}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 md:px-10 md:py-10">
          <div className="mx-auto w-full max-w-[820px]">
          <div className="mb-8 hidden md:block">
            <h1 className="text-lg font-semibold text-fg">设置</h1>
            <p className="mt-1 text-xs text-faint">配置保存在工作区引擎；密钥只回显存在性，留空即保持不变。</p>
          </div>
          <AsyncRegion state={settings} empty={<EmptyState title="无配置" />}>
            {(s) => (
              <div>
                {section === "models" && <ModelsSection s={s} putPatch={putPatch} />}
                {section === "integrations" && <IntegrationsSection s={s} putPatch={putPatch} />}
                {section === "behavior" && <BehaviorSection s={s} putPatch={putPatch} />}
                {section === "system" && <SystemSection s={s} putPatch={putPatch} />}
              </div>
            )}
          </AsyncRegion>
          </div>
        </div>
      )}
    </div>
  )
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="flex h-[38px] flex-none items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-[13px] text-dim transition-colors hover:bg-hover hover:text-fg"
      style={active ? { background: "var(--hover-2)", color: "var(--txt)" } : undefined}
    >
      {icon}
      {label}
    </button>
  )
}

// --- 1. models & providers (cc-switch) ---

type VendorStyle = { bg: string; fg: string }

/** Brand colour per known vendor; the glyph is always the provider's own
 *  initial(s) — user-supplied name wins, we only preset the tile colour. */
function vendorStyle(p: { name: string; kind: string; baseUrl?: string }): VendorStyle {
  // Name/baseUrl only — kind alone must NOT imply a model family（MiniMax 走
  // anthropic 协议 ≠ Anthropic 模型）。
  const n = `${p.name} ${p.baseUrl ?? ""}`.toLowerCase()
  if (n.includes("anthropic") || n.includes("claude")) return { bg: "#F0E2D6", fg: "#B4623F" }
  if (n.includes("智谱") || n.includes("glm") || n.includes("bigmodel") || n.includes("zhipu")) return { bg: "#E3EDFB", fg: "#1F6FE0" }
  if (n.includes("deepseek")) return { bg: "#E4EAF7", fg: "#2C5FD0" }
  if (n.includes("ollama") || n.includes("本地") || n.includes("127.0.0.1") || n.includes("localhost")) return { bg: "#EDEBE4", fg: "#6B6552" }
  if (n.includes("openai") || n.includes("gpt")) return { bg: "#E9F3EC", fg: "#1D8A4D" }
  return { bg: "var(--bg2)", fg: "var(--txt-dim)" }
}

function vendorGlyph(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  // latin/digit names → up to two leading letters; CJK → first character
  const m = trimmed.match(/[A-Za-z0-9]/)
  if (m && /^[A-Za-z0-9 .\-_]+$/.test(trimmed)) {
    const letters = trimmed.replace(/[^A-Za-z0-9]/g, "")
    return letters.slice(0, 2).toUpperCase()
  }
  return trimmed.slice(0, 1)
}

function endpointLabel(baseUrl?: string): string {
  if (!baseUrl) return "自定义端点"
  if (baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost")) return "本地服务"
  return baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
}

function ModelsSection({ s, putPatch }: { s: SettingsView; putPatch: (patch: unknown) => void }): React.ReactElement {
  const [activeId, setActiveId] = useState<string | undefined>(s.activeProviderId)
  const [editing, setEditing] = useState<import("../api/types").ProviderProfile | null>(null)
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">供应商预设</h2>
          <p className="mt-0.5 text-2xs text-faint">一键切换 = 写入 activeProviderId，原子生效；正在运行的会话保持其捕获的模型。</p>
        </div>
        <button className="btn" onClick={() => setEditing({ id: `prov-${Date.now()}`, name: "新预设", kind: "openai", baseUrl: "", hasApiKey: false })}>
          <Plus size={13} /> 新建预设
        </button>
      </div>

      {/* cc-switch style: one compact row per provider — logo tile, name +
          endpoint + model summary, key state, and a switch action */}
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        {(s.providers ?? []).map((p, i) => {
          const active = p.id === activeId
          const vstyle = vendorStyle(p)
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => setEditing(p)}
              onKeyDown={(e) => e.key === "Enter" && setEditing(p)}
              className={`group flex cursor-pointer items-center gap-3 px-3.5 py-3 transition-colors ${i > 0 ? "border-t border-line" : ""} ${active ? "bg-hover" : "hover:bg-hover/60"}`}
            >
              {/* logo tile — initial(s), brand-tinted */}
              <div
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-[14px] font-bold leading-none"
                style={{ background: vstyle.bg, color: vstyle.fg }}
                title={p.name}
              >
                {vendorGlyph(p.name)}
              </div>

              {/* name + endpoint */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-fg">{p.name}</span>
                  {active && (
                    <span className="flex-none rounded-full bg-bg2 px-2 py-0.5 text-[10px] text-dim">
                      <Check size={10} className="mr-0.5 inline" />
                      使用中
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-2xs text-faint">
                  <span className="truncate font-mono">{endpointLabel(p.baseUrl)}</span>
                  <span className="hidden flex-none sm:inline">·</span>
                  <span className="hidden flex-none truncate font-mono sm:inline">{p.model ?? "—"}</span>
                </div>
              </div>

              {/* key state */}
              <span className="hidden flex-none items-center gap-1.5 text-2xs text-faint md:flex">
                <KeyRound size={12} className={p.hasApiKey ? "text-ok" : "text-ghost"} />
                {p.hasApiKey ? "已配置 Key" : "未配置 Key"}
              </span>

              {/* actions: switch + delete */}
              <div className="flex flex-none items-center gap-1.5">
                {active ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full text-ok" title="正在使用 · 点击编辑">
                    <Check size={16} />
                  </span>
                ) : (
                  <button
                    className="btn btn-primary flex-none !py-1 !px-3.5 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveId(p.id)
                      putPatch({ activeProviderId: p.id })
                    }}
                  >
                    切换
                  </button>
                )}
                <button
                  className="icon-btn !h-6 !w-6 text-ghost hover:text-bad"
                  title="删除此预设"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`删除预设「${p.name}」？`)) {
                      putPatch({ providersRemove: [p.id] })
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <ProviderEditor provider={editing} onClose={() => setEditing(null)} onActivate={(id) => { setActiveId(id); putPatch({ activeProviderId: id }) }} putPatch={putPatch} />

      <ModelCatalogNote />
    </div>
  )
}

/** Provider detail/editor modal (local-only this pass; wiring day maps to
 *  PUT /v1/settings with key redaction preserved). */
function ProviderEditor({
  provider,
  onClose,
  onActivate,
  putPatch,
}: {
  provider: import("../api/types").ProviderProfile | null
  onClose: () => void
  onActivate: (id: string) => void
  putPatch: (patch: unknown) => void
}): React.ReactElement | null {
  if (!provider) return null
  return (
    <Modal open={!!provider} onClose={onClose} title="编辑供应商" width={560}>
      <ProviderEditorBody key={provider.id} provider={provider} onActivate={onActivate} onClose={onClose} putPatch={putPatch} />
    </Modal>
  )
}

function ProviderEditorBody({
  provider,
  onActivate,
  onClose,
  putPatch,
}: {
  provider: import("../api/types").ProviderProfile
  onActivate: (id: string) => void
  onClose: () => void
  putPatch: (patch: unknown) => void
}): React.ReactElement {
  const [name, setName] = useState(provider.name)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "")
  const [kind, setKind] = useState(provider.kind)
  const [apiKey, setApiKey] = useState("")
  // one provider can serve many models — seed from the capability catalog
  const seedModels = seedModelsFor(provider)
  const [rows, setRows] = useState<ModelRow[]>(seedModels)
  const [fetching, setFetching] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)
  const [fetched, setFetched] = useState(false)
  const vstyle = vendorStyle({ name, kind, baseUrl })
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const addRow = () => setRows((r) => [...r, { id: `m-${Date.now()}`, mid: "", vision: false, reasoning: false, window: "" }])
  const patch = (id: string, k: keyof ModelRow, v: unknown) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)))
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id))

  // One-click pull: GET /v1/models（引擎用【当前生效】供应商拉取——编辑中的
  // 预设如果尚未激活，先保存+激活再拉取）,把返回的模型 id 注册进列表。
  const pullModels = () => {
    setFetching(true)
    api.models()
      .then((ids) => {
        setRows((existing) => {
          const have = new Set(existing.map((r) => r.mid).filter(Boolean))
          const merged = [...existing]
          for (const id of ids) if (!have.has(id)) merged.push({ id, mid: id, vision: false, reasoning: false, window: "" })
          return merged
        })
        setFetching(false)
        setFetched(true)
      })
      .catch((e) => {
        setPullError(e instanceof Error ? e.message : String(e))
        setFetching(false)
      })
  }

  return (
    <div className="space-y-4">
      {/* identity: logo tile + name */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-lg font-bold"
          style={{ background: vstyle.bg, color: vstyle.fg }}
        >
          {vendorGlyph(name)}
        </div>
        <div className="flex-1">
          <label className="label">显示名称（logo 取首字母）</label>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Anthropic 官方" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">接口协议</label>
          <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="anthropic">anthropic（Anthropic Messages）</option>
            <option value="openai">openai（OpenAI Chat）</option>
            <option value="openai-responses">openai-responses（Responses API）</option>
          </select>
        </div>
        <div>
          <label className="label">Base URL</label>
          <input className="input mt-1 font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.anthropic.com" />
        </div>
      </div>

      {/* models served by this provider */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="label !mb-0">已注册模型（{rows.length}）</label>
          {pullError && <p className="mb-2 text-2xs text-bad">拉取失败：{pullError}（拉取走当前生效供应商；新预设请先保存并激活）</p>}
          <div className="flex items-center gap-2">
            <button
              className="btn !py-1 text-2xs"
              onClick={pullModels}
              disabled={fetching}
              title="从该供应商的 /models 端点拉取并注册模型"
            >
              {fetching ? <RefreshCw size={12} className="animate-spin" /> : <DownloadCloud size={12} />}
              {fetching ? "拉取中…" : fetched ? "重新拉取" : "一键拉取模型"}
            </button>
            <button className="btn !py-1 text-2xs" onClick={addRow}>
              <Plus size={12} /> 手动添加
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg2 px-2.5 py-2">
              <input
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg outline-none placeholder:text-ghost"
                value={r.mid}
                onChange={(e) => patch(r.id, "mid", e.target.value)}
                placeholder="模型 ID，如 claude-sonnet-4-5"
              />
              <button
                className={`flex-none rounded-full px-2 py-0.5 text-[10px] ${r.reasoning ? "bg-hover text-fg" : "text-ghost"}`}
                title="支持推理"
                onClick={() => patch(r.id, "reasoning", !r.reasoning)}
              >
                推理
              </button>
              <button
                className={`flex-none rounded-full px-2 py-0.5 text-[10px] ${r.vision ? "bg-hover text-fg" : "text-ghost"}`}
                title="支持图像"
                onClick={() => patch(r.id, "vision", !r.vision)}
              >
                视觉
              </button>
              <button className="flex-none text-ghost hover:text-bad" title="移除" onClick={() => remove(r.id)}>
                <X size={13} />
              </button>
            </div>
          ))}
          {rows.length === 0 && <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-2xs text-ghost">还没有模型，点「添加模型」</p>}
        </div>
      </div>

      <div>
        <label className="label">API Key</label>
        <input
          className="input mt-1 font-mono"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider.hasApiKey ? `已配置（${provider.apiKeyHint ?? "留空保持不变"}）` : "粘贴 API Key"}
        />
        <p className="mt-1.5 text-2xs text-faint">密钥往返不回显；留空表示保持现有值不变。</p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <button className="btn" onClick={() => {
          putPatch({ activeProviderId: provider.id })
          onActivate(provider.id)
        }}>
          <Check size={13} /> 设为当前供应商
        </button>
        <div className="flex gap-2">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={() => {
            // PUT providers upsert (engine merge: id 主键、apiKey 留空=保持、
            // CLEARABLE 字段原样覆盖) + 同 patch 原子切换 activeProviderId。
            const firstModel = rows.map((r) => r.mid).filter(Boolean)[0]
            if (!firstModel) {
              setSaveErr("至少注册一个模型（一键拉取或手动添加）——没有模型的预设会回落到引擎默认模型。")
              return
            }
            const profile: Record<string, unknown> = { id: provider.id, name, kind, baseUrl, model: firstModel }
            if (apiKey.trim()) profile.apiKey = apiKey.trim()
            putPatch({ providers: [profile], activeProviderId: provider.id })
            onActivate(provider.id)
            onClose()
          }}>保存</button>
        </div>
        {saveErr && <p className="text-2xs text-bad">{saveErr}</p>}
      </div>
    </div>
  )
}

interface ModelRow {
  id: string
  mid: string
  reasoning: boolean
  vision: boolean
  window: string
}

/** Vendor display families matched on NAME + baseUrl ONLY — never kind
 *  (MiniMax 走 anthropic 协议 ≠ Anthropic 模型：kind 参与匹配会把 claude
 *  三件套塞进每个 anthropic 协议的预设)。匹配顺序敏感：MiniMax 的端点路径里
 *  含 "anthropic"（api.minimaxi.com/anthropic），必须先于 anthropic 判断。 */
function seedModelsFor(p: import("../api/types").ProviderProfile): ModelRow[] {
  const n = `${p.name} ${p.baseUrl ?? ""}`.toLowerCase()
  let family: Array<{ mid: string; reasoning: boolean; vision: boolean; window: string }>
  if (n.includes("minimax")) {
    family = [{ mid: "MiniMax-M3", reasoning: true, vision: false, window: "" }]
  } else if (n.includes("anthropic.com") || n.includes("claude")) {
    family = [
      { mid: "claude-opus-4-1", reasoning: true, vision: true, window: "200k" },
      { mid: "claude-sonnet-4-5", reasoning: true, vision: true, window: "200k" },
      { mid: "claude-haiku-4-5", reasoning: false, vision: true, window: "200k" },
    ]
  } else if (n.includes("智谱") || n.includes("glm") || n.includes("bigmodel")) {
    family = [
      { mid: "glm-4.6", reasoning: true, vision: false, window: "128k" },
      { mid: "glm-4.6-flash", reasoning: false, vision: true, window: "128k" },
    ]
  } else if (n.includes("deepseek")) {
    family = [{ mid: "deepseek-chat", reasoning: true, vision: false, window: "128k" }, { mid: "deepseek-reasoner", reasoning: true, vision: false, window: "128k" }]
  } else if (n.includes("ollama") || n.includes("本地") || n.includes("127.0.0.1")) {
    family = [{ mid: p.model ?? "qwen2.5-coder:7b", reasoning: false, vision: false, window: "32k" }]
  } else {
    family = p.model ? [{ mid: p.model, reasoning: false, vision: false, window: "" }] : []
  }
  const rows: ModelRow[] = family.map((f) => ({ id: f.mid, ...f }))
  if (p.model && !rows.some((r) => r.mid === p.model)) {
    rows.unshift({ id: p.model, mid: p.model, reasoning: true, vision: false, window: p.contextWindowTokens ? `${Math.round(p.contextWindowTokens / 1000)}k` : "" })
  }
  return rows
}

function ModelCatalogNote(): React.ReactElement {
  const catalog = useApi(() => api.catalog(), [])
  const models = useApi(() => api.models(), [])
  return (
    <div className="card mt-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Boxes size={14} className="text-dim" />
        <h3 className="text-sm font-medium text-fg">当前供应商可用模型</h3>
        <button className="icon-btn ml-auto !h-6 !w-6" title="重新拉取" onClick={models.retry}>
          <RefreshCw size={12} />
        </button>
      </div>
      {catalog.loading || models.loading ? (
        <LoadingState className="!py-6" />
      ) : catalog.data ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {catalog.data.providers.flatMap((p) => p.models).map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-md border border-line bg-bg2 px-2.5 py-2">
              <span className="flex-1 truncate font-mono text-2xs text-fg">{m.id}</span>
              {m.reasoning && <span className="chip !py-0 !text-[10px]">推理</span>}
              {m.modalities?.includes("image") && <span className="chip !py-0 !text-[10px]">图像</span>}
              {m.contextWindowTokens && <span className="font-mono text-2xs text-faint">{(m.contextWindowTokens / 1000).toFixed(0)}k</span>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          className="!py-6"
          icon={<Boxes size={16} />}
          title="模型能力目录不可用"
          hint="引擎未提供 catalog（{catalog: null}）。可手动填写模型名与上下文窗口；接线后自动增强。"
        />
      )}
      {models.data && models.data.length > 0 && (
        <p className="mt-2 text-2xs text-faint">远端模型列表：{models.data.join("、")}</p>
      )}
    </div>
  )
}

// --- 2. integrations: MCP + channels (real PUT round-trips; whole-map
//        semantics — send the FULL desired set, redacted presence keys
//        (hasEnv/hasHeaders/hasSecret) are display-only and never persisted;
//        omitted secret fields keep the stored value engine-side) ---

function IntegrationsSection({ s, putPatch }: { s: SettingsView; putPatch: (patch: unknown) => void }): React.ReactElement {
  const mcp = s.mcpServers ?? {}
  const channels = s.channels ?? []
  const [mcpEdit, setMcpEdit] = useState<{ mode: "new" } | { mode: "edit"; name: string } | null>(null)
  const [chanEdit, setChanEdit] = useState<{ mode: "new" } | { mode: "edit"; id: string } | null>(null)

  const saveMcp = (name: string, cfg: McpServerSettings): void => {
    putPatch({ mcpServers: { ...mcp, [name]: cfg } })
    setMcpEdit(null)
  }
  const removeMcp = (name: string): void => {
    const next = { ...mcp }
    delete next[name]
    putPatch({ mcpServers: next })
  }
  const toggleMcp = (name: string): void => {
    putPatch({ mcpServers: { ...mcp, [name]: { ...mcp[name], enabled: !mcp[name].enabled } } })
  }
  const saveChannel = (cfg: ChannelConfig): void => {
    putPatch({ channels: [...channels.filter((c) => c.id !== cfg.id), cfg] })
    setChanEdit(null)
  }
  const removeChannel = (id: string): void => {
    putPatch({ channels: channels.filter((c) => c.id !== id) })
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-fg">MCP 服务器</h2>
            <p className="mt-0.5 text-2xs text-faint">挂载到工具 seam；env / headers 只回显存在性（保存时留空即保持）。</p>
          </div>
          <button className="btn" onClick={() => setMcpEdit({ mode: "new" })}>
            <Plus size={13} /> 添加服务器
          </button>
        </div>
        {Object.keys(mcp).length === 0 ? (
          <EmptyState icon={<Plug size={16} />} title="未配置 MCP 服务器" hint="添加本地命令式或远程 URL 式 MCP 服务器。" />
        ) : (
          <div className="space-y-2">
            {Object.entries(mcp).map(([name, cfg]: [string, McpServerSettings]) => (
              <McpRow
                key={name}
                name={name}
                cfg={cfg}
                onToggle={() => toggleMcp(name)}
                onEdit={() => setMcpEdit({ mode: "edit", name })}
                onDelete={() => removeMcp(name)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-fg">入站渠道</h2>
            <p className="mt-0.5 text-2xs text-faint">webhook-first：一个渠道绑定一个会话；出站用 HMAC 签名。测试消息走进件通道（会话忙时显式报错）。</p>
          </div>
          <button className="btn" onClick={() => setChanEdit({ mode: "new" })}>
            <Plus size={13} /> 添加渠道
          </button>
        </div>
        {channels.length === 0 ? (
          <EmptyState icon={<Webhook size={16} />} title="未配置入站渠道" hint="添加一个渠道 id，POST /v1/channel/:id/inbound 即可投递消息。" />
        ) : (
          <div className="space-y-2">
            {channels.map((c) => (
              <div key={c.id} className="card flex items-center gap-3 p-3.5">
                <Webhook size={15} className={c.enabled ? "text-ok" : "text-faint"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-fg">{c.id}</span>
                    <Toggle checked={!!c.enabled} onChange={(v) => putPatch({ channels: [...channels.filter((x) => x.id !== c.id), { ...c, enabled: v }] })} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-2xs text-faint">
                    <Link2 size={10} />
                    <span className="truncate font-mono">{c.webhookUrl || "未配置出站 webhook"}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-faint">
                    {c.hasSecret ? <span className="text-ok">签名密钥已配置</span> : <span className="text-warn">未配置签名密钥</span>}
                    {c.sessionId && <span className="ml-2 font-mono">→ {c.sessionId}</span>}
                  </div>
                </div>
                <button
                  className="btn !py-1 text-2xs"
                  title="向该渠道发一条测试消息（走完整入站→回合→出站链路）"
                  onClick={() => {
                    void api.channelTest(c.id, "集成区测试消息").then((r) => {
                      window.alert(`测试完成（${r.finish}）：${r.reply.slice(0, 120)}`)
                    }).catch((e) => {
                      window.alert("测试失败：" + (e instanceof Error ? e.message : String(e)))
                    })
                  }}
                >
                  <Send size={11} /> 发送测试
                </button>
                <button className="btn !py-1 text-2xs" onClick={() => setChanEdit({ mode: "edit", id: c.id })}>编辑</button>
                <button className="btn btn-danger !py-1 text-2xs" onClick={() => removeChannel(c.id)}>删除</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {mcpEdit && (
        <McpEditor
          name={mcpEdit.mode === "edit" ? mcpEdit.name : ""}
          cfg={mcpEdit.mode === "edit" ? (mcp[mcpEdit.name] ?? {}) : undefined}
          onClose={() => setMcpEdit(null)}
          onSave={saveMcp}
        />
      )}
      {chanEdit && (
        <ChannelEditor
          id={chanEdit.mode === "edit" ? chanEdit.id : ""}
          existing={chanEdit.mode === "edit" ? channels.find((c) => c.id === chanEdit.id) : undefined}
          onClose={() => setChanEdit(null)}
          onSave={saveChannel}
        />
      )}
    </div>
  )
}

/** MCP add/edit form: remote (url) or local (command + args). Edit keeps the
 *  stored env/headers intact engine-side (absent = keep). */
function McpEditor({ name, cfg, onClose, onSave }: { name: string; cfg?: McpServerSettings; onClose: () => void; onSave: (name: string, cfg: McpServerSettings) => void }): React.ReactElement {
  const editing = !!cfg
  const [id, setId] = useState(name)
  const [enabled, setEnabled] = useState(cfg?.enabled ?? true)
  const [url, setUrl] = useState(cfg?.url ?? "")
  const [command, setCommand] = useState(cfg?.command ?? "")
  const [args, setArgs] = useState((cfg?.args ?? []).join(" "))
  const [err, setErr] = useState<string | null>(null)

  const save = (): void => {
    const key = id.trim()
    if (!key) return setErr("名称必填")
    if (url.trim() === "" && command.trim() === "") return setErr("填写 url（远程式）或 command（本地式）")
    onSave(key, url.trim() !== ""
      ? { enabled, url: url.trim() }
      : { enabled, command: command.trim(), args: args.trim() === "" ? [] : args.trim().split(/\s+/) })
  }
  return (
    <Modal open onClose={onClose} title={editing ? `编辑 MCP 服务器 — ${name}` : "添加 MCP 服务器"}>
      <Label>名称（唯一 key）</Label>
      <input className="input font-mono" value={id} disabled={editing} onChange={(e) => setId(e.target.value)} placeholder="context7" />
      <div className="mt-3 flex items-center gap-2">
        <Toggle checked={enabled} onChange={setEnabled} />
        <span className="text-xs text-dim">启用</span>
      </div>
      <div className="mt-3">
        <Label>远程式 URL（与本地命令二选一）</Label>
        <input className="input font-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>本地式命令</Label>
          <input className="input font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-fs" />
        </div>
        <div>
          <Label>参数（空格分隔）</Label>
          <input className="input font-mono" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="G:/workspace" />
        </div>
      </div>
      {err && <p className="mt-2 text-2xs text-bad">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={save}>保存</button>
      </div>
    </Modal>
  )
}

/** Channel add/edit: secret is write-only — empty input keeps the stored one. */
function ChannelEditor({ id, existing, onClose, onSave }: { id: string; existing?: ChannelConfig; onClose: () => void; onSave: (cfg: ChannelConfig) => void }): React.ReactElement {
  const editing = !!existing
  const [cid, setCid] = useState(id)
  const [sessionId, setSessionId] = useState(existing?.sessionId ?? "")
  const [webhookUrl, setWebhookUrl] = useState(existing?.webhookUrl ?? "")
  const [secret, setSecret] = useState("")
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [err, setErr] = useState<string | null>(null)

  const save = (): void => {
    const key = cid.trim()
    if (!key) return setErr("渠道 id 必填")
    // Secret write-only: typed → set; empty on an existing row → keep ("").
    const cfg: ChannelConfig = {
      id: key,
      enabled,
      ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
      ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
      ...(secret ? { secret } : editing ? { secret: "" } : {}),
    }
    onSave(cfg)
  }
  return (
    <Modal open onClose={onClose} title={editing ? `编辑渠道 — ${id}` : "添加渠道"}>
      <Label>渠道 id（唯一 key，入站路径 /v1/channel/:id/inbound）</Label>
      <input className="input font-mono" value={cid} disabled={editing} onChange={(e) => setCid(e.target.value)} placeholder="webhook-main" />
      <div className="mt-3">
        <Label>绑定会话 id（留空 = 渠道常驻会话）</Label>
        <input className="input font-mono" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
      </div>
      <div className="mt-3">
        <Label>出站 webhook URL（可选）</Label>
        <input className="input font-mono" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://example.com/hook" />
      </div>
      <div className="mt-3">
        <Label>HMAC 签名密钥{editing && existing?.hasSecret ? "（已配置——留空保持）" : "（可选）"}</Label>
        <input className="input font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={editing && existing?.hasSecret ? "••••••••" : ""} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Toggle checked={enabled} onChange={setEnabled} />
        <span className="text-xs text-dim">启用</span>
      </div>
      {err && <p className="mt-2 text-2xs text-bad">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={save}>保存</button>
      </div>
    </Modal>
  )
}

function McpRow({ name, cfg, onToggle, onEdit, onDelete }: { name: string; cfg: McpServerSettings; onToggle: () => void; onEdit: () => void; onDelete: () => void }): React.ReactElement {
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <Plug size={15} className={cfg.enabled ? "text-dim" : "text-faint"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-fg">{name}</span>
          <Toggle checked={!!cfg.enabled} onChange={onToggle} />
        </div>
        <div className="mt-0.5 truncate font-mono text-2xs text-faint">
          {cfg.url ? cfg.url : `${cfg.command ?? ""} ${(cfg.args ?? []).join(" ")}`.trim()}
        </div>
        <div className="mt-0.5 flex gap-2 text-2xs">
          {cfg.hasEnv && <span className="text-dim">env 已配置</span>}
          {cfg.hasHeaders && <span className="text-dim">headers 已配置</span>}
          {!cfg.hasEnv && !cfg.hasHeaders && <span className="text-ghost">无密钥项</span>}
        </div>
      </div>
      <button className="btn !py-1 text-2xs" onClick={onEdit}>编辑</button>
      <button className="btn btn-danger !py-1 text-2xs" onClick={onDelete}>删除</button>
    </div>
  )
}

// --- 3. behavior ---

function BehaviorSection({ s, putPatch }: { s: SettingsView; putPatch: (patch: unknown) => void }): React.ReactElement {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-fg">行为与权限</h2>
      <div className="card divide-y divide-line">
        <BoolRow title="允许 Bash 执行" desc="由启动参数决定（NEWHORSE_ALLOW_BASH）；当前会话仍受策略分级约束。" value={s.allowBash} />
        <BoolRow title="允许插件代码执行" desc="由启动参数决定（NEWHORSE_ALLOW_PLUGIN_CODE）。" value={s.allowPluginCode} />
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="text-sm text-fg">默认审批策略</div>
            <div className="mt-0.5 text-2xs text-faint">新会话的起始权限档位；会话页头部可临时切换。</div>
          </div>
          <Segmented
            options={[
              { value: "strict", label: "标准" },
              { value: "readonly", label: "只读规划" },
              { value: "trusted", label: "自动执行" },
            ]}
            value={s.approvalPolicy}
            onChange={(v) => putPatch({ approvalPolicy: v })}
          />
        </div>
      </div>

      <h2 className="pt-2 text-sm font-semibold text-fg">语义记忆</h2>
      <div className="card divide-y divide-line">
        <BoolRow title="启用记忆" desc="回合边界抽取并写入条目库（FTS5 × cosine RRF 混合检索）。" value={s.memory.on} onChange={(v) => putPatch({ memory: { on: v } })} />
        <BoolRow title="自动抽取" desc="从对话中自动沉淀 persona / fact / instruction 记忆。" value={s.memory.extraction} onChange={(v) => putPatch({ memory: { extraction: v } })} />
        <BoolRow title="向量索引" desc={`嵌入模型：${s.memory.vector.embedding.model || "未设置"}（provider 可插拔）`} value={s.memory.vector.enabled} onChange={(v) => putPatch({ memory: { vector: { enabled: v } } })} />
      </div>
    </div>
  )
}

// --- 4. system ---

function SystemSection({ s, putPatch }: { s: SettingsView; putPatch: (patch: unknown) => void }): React.ReactElement {
  const [host, setHost] = useState(s.host)
  const [port, setPort] = useState(String(s.port))
  const [netErr, setNetErr] = useState<string | null>(null)
  const saveNetwork = (): void => {
    const portNum = Number(port)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setNetErr("端口必须是 1–65535 的整数")
      return
    }
    setNetErr(null)
    putPatch({ host: host.trim(), port: portNum })
  }
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-fg">系统</h2>
      <div className="card p-4">
        <Label>访问令牌（Bearer）</Label>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs ${s.hasToken ? "text-ok" : "text-warn"}`}>
            <KeyRound size={12} /> {s.hasToken ? "已配置令牌" : "未配置令牌——局域网访问前必须设置"}
          </span>
          <button className="btn ml-auto !py-1 text-2xs" onClick={() => {
            const t = window.prompt("输入新令牌（留空取消）")
            if (t) putPatch({ token: t })
          }}>重设令牌</button>
        </div>
      </div>

      <div className="card p-4">
        <Label>监听地址</Label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-2xs text-faint">Host</span>
            <input className="input font-mono" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div>
            <span className="mb-1 block text-2xs text-faint">Port</span>
            <input className="input font-mono" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
        </div>
        <button className="btn mt-3 !py-1 text-2xs" onClick={saveNetwork}>保存网络配置（改后重启）</button>
        {netErr && <p className="mt-2 text-2xs text-bad">{netErr}</p>}
        <div className="mt-3 flex items-start gap-2 rounded-md border border-line bg-bg2 p-2.5 text-2xs leading-relaxed text-dim">
          <Smartphone size={13} className="mt-0.5 flex-none text-warn" />
          <span>
            手机访问需把 host 改为 <code className="font-mono">0.0.0.0</code> 并配置令牌（0.0.0.0 + 无令牌 = 局域网裸奔一个能跑 bash 的代理）。改后重启，手机同源打开 <code className="font-mono">http://&lt;本机IP&gt;:{s.port}</code> 并导入令牌。
          </span>
        </div>
      </div>

      <div className="card p-4">
        <Label>数据目录</Label>
        <div className="flex items-center gap-2 font-mono text-2xs text-dim">
          <Network size={12} className="flex-none text-faint" />
          <span className="truncate">{s.agentHome}</span>
        </div>
        <p className="mt-1.5 text-2xs text-faint">事件日志、配置、记忆索引都在此目录；删除即重置本工作区引擎状态。</p>
      </div>
    </div>
  )
}

function BoolRow({ title, desc, value, onChange }: { title: string; desc: string; value: boolean; onChange?: (v: boolean) => Promise<boolean> | void }): React.ReactElement {
  const [v, setV] = useState(value)
  // 乐观切换后跟随服务端值：refetch 回来以 prop 为准；PUT 失败回滚到 prop。
  useEffect(() => {
    setV(value)
  }, [value])
  const flip = (nv: boolean): void => {
    setV(nv)
    const r = onChange?.(nv)
    if (r) {
      void r.then((ok) => {
        if (ok === false) setV(value)
      })
    }
  }
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div>
        <div className="text-sm text-fg">{title}</div>
        <div className="mt-0.5 text-2xs text-faint">{desc}</div>
      </div>
      <Toggle checked={v} onChange={flip} />
    </div>
  )
}
