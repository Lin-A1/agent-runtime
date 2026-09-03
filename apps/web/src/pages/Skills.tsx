/**
 * Skills — the agent skill directory: every SkillInfo as a card with name,
 * description and source path; clicking opens the body. 导入 = POST /v1/skills，
 * 删除 = DELETE /v1/skills?name=（目录即注册面，落盘即可发现，删目录即注销）。
 */
import { useState } from "react"
import { useApi } from "../lib/useApi"
import { ArrowLeft, Check, Copy, FolderOpen, Plus, Sparkles, Trash2, X } from "lucide-react"
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const removeSkill = (name: string): void => {
    void api.deleteSkill(name).then(() => {
      setConfirmDelete(null)
      if (open?.name === name) setOpen(null)
      skills.retry()
    }).catch((e) => window.alert("删除失败：" + (e instanceof Error ? e.message : String(e))))
  }

  const flashCopied = (key: string): void => {
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1_500)
  }
  const copyText = (key: string, text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => flashCopied(key))
      .catch(() => {})
  }
  // 卡片上的「复制正文」需要先拉 body 再写剪贴板。
  const copyBody = (s: SkillInfo): void => {
    void api
      .skillBody(s.name)
      .then((r) => copyText(`body:${s.name}`, r.body ?? ""))
      .catch(() => {})
  }

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
              <div
                key={s.name}
                role="button"
                tabIndex={0}
                onClick={() => setOpen(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setOpen(s)
                }}
                className="card group cursor-pointer p-4 text-left transition-colors hover:border-linestrong hover:bg-cardhover"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-line bg-bg2 text-dim">
                    <Sparkles size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{s.name}</span>
                  <button
                    className="icon-btn !h-6 !w-6 flex-none opacity-0 group-hover:opacity-100"
                    title="复制正文"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyBody(s)
                    }}
                  >
                    {copiedKey === `body:${s.name}` ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                  </button>
                  {confirmDelete === s.name ? (
                    <span className="flex flex-none items-center gap-1 opacity-100">
                      <button
                        className="btn btn-danger !px-2 !py-0.5 text-[10px]"
                        title="确认删除（不可撤销）"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeSkill(s.name)
                        }}
                      >
                        确认
                      </button>
                      <button
                        className="icon-btn !h-5 !w-5"
                        title="取消"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDelete(null)
                        }}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ) : (
                    <button
                      className="icon-btn !h-6 !w-6 flex-none text-ghost opacity-0 hover:text-bad group-hover:opacity-100"
                      title="删除此技能"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete(s.name)
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-faint">{s.description ?? "（无描述）"}</p>
                <p className="mt-3 flex items-center gap-1 truncate border-t border-line pt-2 font-mono text-2xs text-faint" title={s.path}>
                  <FolderOpen size={10} className="flex-none text-dim" /> {s.path}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? "技能"} width={640}>
        <p className="mb-2 text-xs leading-relaxed text-faint">{open?.description}</p>
        {open && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-bg2 px-2.5 py-1.5">
            <FolderOpen size={11} className="flex-none text-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-2xs text-dim" title={open.path}>{open.path}</span>
            <button className="btn !py-0.5 flex-none text-2xs" onClick={() => copyText(`path:${open.name}`, open.path)}>
              {copiedKey === `path:${open.name}` ? <Check size={11} className="text-ok" /> : <Copy size={11} />} 路径
            </button>
          </div>
        )}
        <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-bg2 p-4 font-mono text-2xs leading-relaxed text-dim">{body}</pre>
        <div className="mt-3 flex items-center justify-between">
          <button className="btn" onClick={() => setOpen(null)}>
            <ArrowLeft size={13} /> 返回
          </button>
          <span className="flex items-center gap-2">
            {confirmDelete === open?.name ? (
              <span className="flex items-center gap-1.5">
                <span className="text-2xs text-bad">确认删除？</span>
                <button className="btn btn-danger !py-0.5 text-2xs" onClick={() => removeSkill(open!.name)}>
                  确认
                </button>
                <button className="btn !py-0.5 text-2xs" onClick={() => setConfirmDelete(null)}>
                  取消
                </button>
              </span>
            ) : (
              <button className="btn btn-quiet text-bad" onClick={() => setConfirmDelete(open!.name)}>
                <Trash2 size={13} /> 删除
              </button>
            )}
            <button className="btn" disabled={!body} onClick={() => copyText(`modal:${open?.name}`, body)}>
              {copiedKey === `modal:${open?.name}` ? <Check size={13} className="text-ok" /> : <Copy size={13} />} 复制正文
            </button>
            <button className="btn btn-quiet text-faint" onClick={() => setOpen(null)}>
              <X size={13} /> 关闭
            </button>
          </span>
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
