/**
 * Settings — single page with a left nav (opencode organization) and four
 * sections. Models & providers follows cc-switch: preset cards with one-click
 * atomic switch (activeProviderId), redacted key presence (留空=保持),
 * clearable fields, model list with catalog enhancement (#37). Integration
 * section carries MCP servers (hasEnv/hasHeaders presence) and inbound
 * channels (hasSecret, test-via-inbound). All shapes = SettingsView.
 */
import { useState } from "react"
import { useParams } from "react-router-dom"
import {
  BarChart3,
  Boxes,
  CalendarClock,
  Check,
  Cpu,
  GitBranch,
  Inbox,
  KeyRound,
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
import type { McpServerSettings, SettingsView } from "../api/types"
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
  const isHub = (s: Section): s is HubSection => (["usage", "schedules", "dags", "skills", "memory", "live"] as string[]).includes(s)

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav className="z-20 flex-none overflow-x-auto border-b border-line bg-panel p-2 md:h-auto md:w-[212px] md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r">
        <div className="flex gap-1 md:flex-col md:gap-0.5">
          <div className="hidden px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-ghost md:block">配置</div>
          {CONFIG_NAV.map((n) => (
            <NavButton key={n.id} active={section === n.id} icon={n.icon} label={n.label} onClick={() => setSection(n.id)} />
          ))}
          <div className="hidden border-t border-line md:mb-1 md:ml-2 md:mt-3 md:block" />
          <div className="hidden px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-ghost md:block">数据与能力</div>
          {HUB_NAV.map((n) => (
            <NavButton key={n.id} active={section === n.id} icon={n.icon} label={n.label} onClick={() => setSection(n.id)} />
          ))}
        </div>
      </nav>

      {isHub(section) ? (
        <div className="hub-embedded flex min-h-0 min-w-0 flex-1 flex-col">{(() => { const P = HUB_PAGES[section]; return <P /> })()}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[820px]">
          <div className="mb-6 hidden md:block">
            <h1 className="text-lg font-semibold text-fg">设置</h1>
            <p className="mt-1 text-xs text-faint">配置保存在工作区引擎；密钥只回显存在性，留空即保持不变。</p>
          </div>
          <AsyncRegion state={settings} empty={<EmptyState title="无配置" />}>
            {(s) => (
              <div>
                {section === "models" && <ModelsSection s={s} />}
                {section === "integrations" && <IntegrationsSection s={s} />}
                {section === "behavior" && <BehaviorSection s={s} />}
                {section === "system" && <SystemSection s={s} />}
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
      className="flex h-9 flex-none items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-dim transition-colors hover:bg-hover hover:text-fg"
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
  const n = `${p.name} ${p.kind} ${p.baseUrl ?? ""}`.toLowerCase()
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

function ModelsSection({ s }: { s: SettingsView }): React.ReactElement {
  const [activeId, setActiveId] = useState<string | undefined>(s.activeProviderId)
  const [editing, setEditing] = useState<import("../api/types").ProviderProfile | null>(null)
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">供应商预设</h2>
          <p className="mt-0.5 text-2xs text-faint">一键切换 = 写入 activeProviderId，原子生效；正在运行的会话保持其捕获的模型。</p>
        </div>
        <button className="btn">
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

              {/* actions: click row (or the edit affordance) to edit; switch
                  stays a dedicated button on non-active rows */}
              {active ? (
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-ok" title="正在使用 · 点击编辑">
                  <Check size={16} />
                </span>
              ) : (
                <button
                  className="btn btn-primary flex-none !py-1 !px-3.5 text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveId(p.id)
                  }}
                >
                  切换
                </button>
              )}
            </div>
          )
        })}
      </div>

      <ProviderEditor provider={editing} onClose={() => setEditing(null)} onActivate={(id) => setActiveId(id)} />

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
}: {
  provider: import("../api/types").ProviderProfile | null
  onClose: () => void
  onActivate: (id: string) => void
}): React.ReactElement | null {
  if (!provider) return null
  return (
    <Modal open={!!provider} onClose={onClose} title="编辑供应商" width={560}>
      <ProviderEditorBody key={provider.id} provider={provider} onActivate={onActivate} onClose={onClose} />
    </Modal>
  )
}

function ProviderEditorBody({
  provider,
  onActivate,
  onClose,
}: {
  provider: import("../api/types").ProviderProfile
  onActivate: (id: string) => void
  onClose: () => void
}): React.ReactElement {
  const [name, setName] = useState(provider.name)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "")
  const [kind, setKind] = useState(provider.kind)
  const [apiKey, setApiKey] = useState("")
  // one provider can serve many models — seed from the capability catalog
  const seedModels = seedModelsFor(provider)
  const [rows, setRows] = useState<ModelRow[]>(seedModels)
  const vstyle = vendorStyle({ name, kind, baseUrl })

  const addRow = () => setRows((r) => [...r, { id: `m-${Date.now()}`, mid: "", vision: false, reasoning: false, window: "", def: false }])
  const patch = (id: string, k: keyof ModelRow, v: unknown) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)))
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id))
  const makeDefault = (id: string) => setRows((rs) => rs.map((r) => ({ ...r, def: r.id === id })))

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
            <option value="openai">openai（OpenAI 兼容）</option>
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
          <label className="label !mb-0">模型（{rows.length}）</label>
          <button className="btn !py-1 text-2xs" onClick={addRow}>
            <Plus size={12} /> 添加模型
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg2 px-2.5 py-2">
              <button
                className="flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[10px]"
                style={r.def ? { borderColor: "var(--txt)", background: "var(--txt)", color: "var(--bg)" } : { borderColor: "var(--line-strong)" }}
                title="设为默认模型"
                onClick={() => makeDefault(r.id)}
              >
                {r.def && <Check size={10} />}
              </button>
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
        <button className="btn" onClick={() => onActivate(provider.id)}>
          <Check size={13} /> 设为当前供应商
        </button>
        <div className="flex gap-2">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onClose}>保存</button>
        </div>
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
  def: boolean
}

/** Realistic per-vendor model families (hard-coded this pass); the default
 *  model from the provider is marked and falls into the right family. */
function seedModelsFor(p: import("../api/types").ProviderProfile): ModelRow[] {
  const n = `${p.name} ${p.kind} ${p.baseUrl ?? ""}`.toLowerCase()
  let family: Array<{ mid: string; reasoning: boolean; vision: boolean; window: string }>
  if (n.includes("anthropic") || n.includes("claude")) {
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
  const rows: ModelRow[] = family.map((f) => ({ id: f.mid, ...f, def: f.mid === p.model }))
  if (p.model && !rows.some((r) => r.mid === p.model)) {
    rows.unshift({ id: p.model, mid: p.model, reasoning: true, vision: false, window: p.contextWindowTokens ? `${Math.round(p.contextWindowTokens / 1000)}k` : "", def: true })
  }
  if (rows.length && !rows.some((r) => r.def)) rows[0].def = true
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
      ) : catalog.data?.catalog ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {catalog.data.catalog.providers.flatMap((p) => p.models).map((m) => (
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
      {models.data && models.data.models.length > 0 && (
        <p className="mt-2 text-2xs text-faint">远端模型列表：{models.data.models.join("、")}</p>
      )}
    </div>
  )
}

// --- 2. integrations: MCP + channels ---

function IntegrationsSection({ s }: { s: SettingsView }): React.ReactElement {
  const mcp = s.mcpServers ?? {}
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-fg">MCP 服务器</h2>
            <p className="mt-0.5 text-2xs text-faint">挂载到工具 seam；env / headers 只回显存在性（已配置 N 项，留空保持）。</p>
          </div>
          <button className="btn">
            <Plus size={13} /> 添加服务器
          </button>
        </div>
        {Object.keys(mcp).length === 0 ? (
          <EmptyState icon={<Plug size={16} />} title="未配置 MCP 服务器" hint="添加本地命令式或远程 URL 式 MCP 服务器。" />
        ) : (
          <div className="space-y-2">
            {Object.entries(mcp).map(([name, cfg]: [string, McpServerSettings]) => (
              <McpRow key={name} name={name} cfg={cfg} />
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
          <button className="btn">
            <Plus size={13} /> 添加渠道
          </button>
        </div>
        <div className="space-y-2">
          {(s.channels ?? []).map((c) => (
            <div key={c.id} className="card flex items-center gap-3 p-3.5">
              <Webhook size={15} className={c.enabled ? "text-ok" : "text-faint"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-fg">{c.id}</span>
                  <Toggle checked={!!c.enabled} />
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
              <button className="btn !py-1 text-2xs">
                <Send size={11} /> 发送测试
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function McpRow({ name, cfg }: { name: string; cfg: McpServerSettings }): React.ReactElement {
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <Plug size={15} className={cfg.enabled ? "text-dim" : "text-faint"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-fg">{name}</span>
          <Toggle checked={!!cfg.enabled} />
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
      <button className="btn !py-1 text-2xs">编辑</button>
    </div>
  )
}

// --- 3. behavior ---

function BehaviorSection({ s }: { s: SettingsView }): React.ReactElement {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-fg">行为与权限</h2>
      <div className="card divide-y divide-line">
        <BoolRow title="允许 Bash 执行" desc="关闭后工具面不提供 shell；开启时仍受会话策略分级约束。" value={s.allowBash} />
        <BoolRow title="允许插件代码执行" desc="插件工具与技能在受限装载层运行。" value={s.allowPluginCode} />
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
          />
        </div>
      </div>

      <h2 className="pt-2 text-sm font-semibold text-fg">语义记忆</h2>
      <div className="card divide-y divide-line">
        <BoolRow title="启用记忆" desc="回合边界抽取并写入条目库（FTS5 × cosine RRF 混合检索）。" value={s.memory.on} />
        <BoolRow title="自动抽取" desc="从对话中自动沉淀 persona / fact / instruction 记忆。" value={s.memory.extraction} />
        <BoolRow title="向量索引" desc={`嵌入模型：${s.memory.vector.embedding.model || "未设置"}（provider 可插拔）`} value={s.memory.vector.enabled} />
      </div>
    </div>
  )
}

// --- 4. system ---

function SystemSection({ s }: { s: SettingsView }): React.ReactElement {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-fg">系统</h2>
      <div className="card p-4">
        <Label>访问令牌（Bearer）</Label>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs ${s.hasToken ? "text-ok" : "text-warn"}`}>
            <KeyRound size={12} /> {s.hasToken ? "已配置令牌" : "未配置令牌——局域网访问前必须设置"}
          </span>
          <button className="btn ml-auto !py-1 text-2xs">重设令牌</button>
        </div>
      </div>

      <div className="card p-4">
        <Label>监听地址</Label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-2xs text-faint">Host</span>
            <input className="input font-mono" defaultValue={s.host} />
          </div>
          <div>
            <span className="mb-1 block text-2xs text-faint">Port</span>
            <input className="input font-mono" defaultValue={String(s.port)} />
          </div>
        </div>
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

function BoolRow({ title, desc, value }: { title: string; desc: string; value: boolean }): React.ReactElement {
  const [v, setV] = useState(value)
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div>
        <div className="text-sm text-fg">{title}</div>
        <div className="mt-0.5 text-2xs text-faint">{desc}</div>
      </div>
      <Toggle checked={v} onChange={setV} />
    </div>
  )
}
