/**
 * Memory — semantic-memory browser over hard-coded fixtures, with live local
 * interaction: debounced search filters, two-step delete, and manual write all
 * mutate local state (no API this pass; wiring day swaps to /v1/memory).
 */
import { useMemo, useState } from "react"
import { Brain, Inbox, Plus, Search, Trash2 } from "lucide-react"
import { api } from "../api/client"
import type { MemoryRecord, MemoryType } from "../api/types"
import { relativeTime } from "../api/fold"
import { EmptyState, Modal, PageHeader } from "../components/ui"

const TYPE_LABEL: Record<MemoryType, string> = {
  persona: "画像",
  episodic: "经历",
  instruction: "指令",
  fact: "事实",
}

export function MemoryPage(): React.ReactElement {
  const [items, setItems] = useState<MemoryRecord[]>(() => api.memory().memories)
  const [q, setQ] = useState("")
  const [writeOpen, setWriteOpen] = useState(false)
  const [draft, setDraft] = useState({ content: "", type: "fact" as MemoryType, priority: 60 })
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return kw ? items.filter((m) => m.content.toLowerCase().includes(kw)) : items
  }, [items, q])

  const addMemory = (): void => {
    if (!draft.content.trim()) return
    setItems((p) => [
      {
        id: `mem-new-${Date.now()}`,
        content: draft.content.trim(),
        type: draft.type,
        priority: draft.priority,
        sessionId: "sess-nh-butler",
        createdAt: Date.now(),
      },
      ...p,
    ])
    setDraft({ content: "", type: "fact", priority: 60 })
    setWriteOpen(false)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="记忆" backTo="/settings"
        sub="事件溯源的语义记忆条目库（FTS5 × cosine RRF 混合检索）；向量索引是可插拔 provider。"
        actions={
          <button className="btn btn-primary" onClick={() => setWriteOpen(true)}>
            <Plus size={13} /> 写入记忆
          </button>
        }
      />
      <div className="border-b border-line px-6 py-3">
        <div className="flex max-w-xl items-center gap-2 rounded-xl border border-line bg-bg2 px-3.5 py-2.5">
          <Search size={15} className="flex-none text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索记忆内容…" className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-ghost" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          className="!py-24"
          icon={<Inbox size={18} />}
          title={q ? "没有匹配的记忆" : "还没有记忆条目"}
          hint={q ? "换个关键词，或清空搜索。" : "开启行为设置里的自动抽取后，对话会沉淀为记忆；也可以手动写入。"}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((m) => (
              <div key={m.id} className="card group p-4">
                <div className="flex items-center gap-2">
                  <span className="chip !py-0 !text-[10px]">{TYPE_LABEL[m.type]}</span>
                  <span className="flex items-center gap-1 font-mono text-2xs text-faint">
                    <Brain size={10} /> 优先级 {m.priority}
                  </span>
                  <span className="ml-auto text-2xs text-faint">{relativeTime(m.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-fg">{m.content}</p>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
                  <span className="truncate font-mono text-2xs text-ghost">{m.sessionId}</span>
                  {confirmId === m.id ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-2xs text-bad">确认删除？</span>
                      <button
                        className="btn btn-danger !py-0.5 text-2xs"
                        onClick={() => {
                          setItems((p) => p.filter((x) => x.id !== m.id))
                          setConfirmId(null)
                        }}
                      >
                        <Trash2 size={11} /> 删除
                      </button>
                      <button className="btn !py-0.5 text-2xs" onClick={() => setConfirmId(null)}>
                        取消
                      </button>
                    </span>
                  ) : (
                    <button className="btn btn-quiet !py-1 text-2xs opacity-0 group-hover:opacity-100" onClick={() => setConfirmId(m.id)}>
                      <Trash2 size={12} /> 删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={writeOpen} onClose={() => setWriteOpen(false)} title="写入记忆">
        <textarea
          className="input min-h-[120px] resize-y"
          placeholder="要记住的内容…"
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
        />
        <div className="mt-3 flex items-center gap-3 text-2xs text-dim">
          <label className="flex items-center gap-1.5">
            类型
            <select className="input !w-auto !py-1 text-2xs" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as MemoryType }))}>
              <option value="fact">fact 事实</option>
              <option value="instruction">instruction 指令</option>
              <option value="persona">persona 画像</option>
              <option value="episodic">episodic 经历</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            优先级
            <input
              type="number"
              min={0}
              max={100}
              className="input !w-20 !py-1 text-2xs"
              value={draft.priority}
              onChange={(e) => setDraft((d) => ({ ...d, priority: Number(e.target.value) }))}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setWriteOpen(false)}>
            取消
          </button>
          <button className="btn btn-primary" onClick={addMemory} disabled={!draft.content.trim()}>
            保存
          </button>
        </div>
      </Modal>
    </div>
  )
}
