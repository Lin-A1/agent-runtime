/**
 * Skills — the agent skill directory: every SkillInfo as a card with name,
 * description and source path; clicking opens the body. 导入 = POST /v1/skills
 * writes pluginsDir/skills/<name>/SKILL.md（目录即注册面，落盘即可发现）。
 */
import { useState } from "react"
import { useApi } from "../lib/useApi"
import { ArrowLeft, FolderOpen, Plus, Sparkles, X } from "lucide-react"
import { api } from "../api/client"
import type { SkillInfo } from "../api/types"
import { EmptyState, Modal, PageHeader } from "../components/ui"

export function SkillsPage(): React.ReactElement {
  const skills = useApi<{ skills: SkillInfo[] }>(() => api.skills(), [])
  const list = skills.data?.skills ?? []
  const [open, setOpen] = useState<SkillInfo | null>(null)
  const bodyState = useApi<{ body?: string }>(() => (open ? api.skillBody(open.name) : Promise.resolve({ body: "" })), [open?.name])
  const body = bodyState.data?.body ?? ""
  const [importOpen, setImportOpen] = useState(false)
  const [draft, setDraft] = useState({ name: "", description: "", body: "" })
  const [importErr, setImportErr] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const doImport = (): void => {
    if (!draft.name.trim() || !draft.body.trim()) return
    setImporting(true)
    setImportErr(null)
    void api.importSkill(draft.name.trim(), draft.body.trim(), draft.description.trim() || undefined)
      .then(() => {
        setImportOpen(false)
        setDraft({ name: "", description: "", body: "" })
        skills.retry()
      })
      .catch((e) => setImportErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setImporting(false))
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="技能"
        backTo="/settings"
        sub="按需装载的能力包：模型在需要时通过 skill 工具加载正文，平时不占上下文。"
        actions={
          <span className="flex items-center gap-2">
            <span className="chip">
              <Sparkles size={11} /> {list.length} 个已发现
            </span>
            <button className="btn btn-primary" onClick={() => setImportOpen(true)}>
              <Plus size={13} /> 导入技能
            </button>
          </span>
        }
      />
      {list.length === 0 ? (
        <EmptyState className="!py-24" icon={<Sparkles size={18} />} title="没有发现技能" hint="点击右上角导入，或把 SKILL.md 放进引擎插件目录的 skills/ 下。" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s: SkillInfo) => (
              <button
                key={s.name}
                onClick={() => setOpen(s)}
                className="card group p-4 text-left transition-colors hover:border-linestrong hover:bg-cardhover"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-line bg-bg2 text-dim">
                    <Sparkles size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{s.name}</span>
                </div>
                <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-faint">{s.description ?? "（无描述）"}</p>
                <p className="mt-3 flex items-center gap-1 truncate border-t border-line pt-2 font-mono text-2xs text-ghost">
                  <FolderOpen size={10} className="flex-none" /> {s.path}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? "技能"} width={640}>
        <p className="mb-3 text-xs leading-relaxed text-faint">{open?.description}</p>
        <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-bg2 p-4 font-mono text-2xs leading-relaxed text-dim">{body}</pre>
        <div className="mt-3 flex items-center justify-between">
          <button className="btn" onClick={() => setOpen(null)}>
            <ArrowLeft size={13} /> 返回
          </button>
          <button className="btn btn-quiet text-faint" onClick={() => setOpen(null)}>
            <X size={13} /> 关闭
          </button>
        </div>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="导入技能" width={620}>
        <p className="mb-3 text-2xs leading-relaxed text-faint">技能 = 一段模型按需加载的说明文本（SKILL.md）。导入后写入引擎插件目录，立即出现在目录与 @ 提及里。</p>
        <input className="input font-mono" placeholder="技能名（slug，如 weekly-report）" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        <input className="input mt-2" placeholder="一句话描述（目录卡片上显示）" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
        <textarea className="input mt-2 min-h-[200px] resize-y font-mono text-2xs" placeholder="技能正文（markdown）…" value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
        {importErr && <p className="mt-2 text-2xs text-bad">{importErr}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setImportOpen(false)}>取消</button>
          <button className="btn btn-primary" disabled={importing || !draft.name.trim() || !draft.body.trim()} onClick={doImport}>
            {importing ? "写入中…" : "导入"}
          </button>
        </div>
      </Modal>
    </div>
  )
}
