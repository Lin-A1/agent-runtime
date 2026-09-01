/**
 * Fixture session registry — SessionRow[] exactly as GET /v1/sessions
 * returns it. Two workspaces, each with a pinned resident newhorse session
 * (role: "butler" — the wire key; UI copy says newhorse), child sessions
 * (parentId) covering the seven subagent states, timeline spread and an
 * archived group.
 */
import type { SessionRow } from "../api/types"
import { ago, hoursAgo, daysAgo } from "./util"

export const WS_NH = "G:\\Code\\Agents\\Custom\\newhorse"
export const WS_DSH = "G:\\Code\\Projects\\dsh-hub"

export interface WorkspaceInfo {
  path: string
  name: string
}

export const WORKSPACES: WorkspaceInfo[] = [
  { path: WS_NH, name: "newhorse" },
  { path: WS_DSH, name: "dsh-hub" },
  { path: "G:\\Code\\Experiments\\playground", name: "playground" },
]

/** The demo resident session — its event log is buildDemoEvents(). */
export const BUTLER_NH = "sess-nh-butler"
export const BUTLER_DSH = "sess-dsh-butler"

export function buildSessions(): SessionRow[] {
  return [
    // --- workspace: newhorse ---
    {
      sessionId: BUTLER_NH,
      workspace: WS_NH,
      title: "newhorse 会话",
      status: "active",
      model: "claude-sonnet-4-5",
      role: "butler",
      createdAt: daysAgo(21),
      updatedAt: ago(12),
      tokensUsed: 182_400,
    },
    // children of the resident session (subagent tree)
    {
      sessionId: "sess-nh-child-run",
      workspace: WS_NH,
      title: "重构 dag runner 的事件唤醒路径",
      status: "active",
      model: "glm-4.6-flash",
      parentId: BUTLER_NH,
      createdAt: hoursAgo(2),
      updatedAt: ago(6),
      tokensUsed: 12_300,
    },
    {
      sessionId: "sess-nh-child-block",
      workspace: WS_NH,
      title: "批量重命名 events 表索引",
      status: "active",
      model: "glm-4.6-flash",
      parentId: BUTLER_NH,
      createdAt: hoursAgo(1),
      updatedAt: ago(3),
      tokensUsed: 4_800,
    },
    {
      sessionId: "sess-nh-child-wait",
      workspace: WS_NH,
      title: "整理 sidePane 标签的优先级意见",
      status: "created",
      model: "glm-4.6-flash",
      parentId: BUTLER_NH,
      createdAt: ago(20),
      updatedAt: ago(20),
    },
    {
      sessionId: "sess-nh-child-lost",
      workspace: WS_NH,
      title: "扫描 docs 下的漂移哨兵引用",
      status: "active",
      model: "glm-4.6-flash",
      parentId: BUTLER_NH,
      createdAt: hoursAgo(26),
      updatedAt: hoursAgo(25),
      tokensUsed: 2_100,
    },
    {
      sessionId: "sess-nh-child-ok",
      workspace: WS_NH,
      title: "定位 resumeDag 的重放入口",
      status: "settled",
      model: "glm-4.6-flash",
      parentId: BUTLER_NH,
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(4),
      tokensUsed: 3_400,
    },
    {
      sessionId: "sess-nh-child-fail",
      workspace: WS_NH,
      title: "尝试 Bun 升级后的 SSE 断连复现",
      status: "interrupted",
      model: "claude-sonnet-4-5",
      parentId: BUTLER_NH,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2, 16),
      tokensUsed: 9_900,
    },
    // regular sessions (timeline spread)
    {
      sessionId: "sess-nh-s1",
      workspace: WS_NH,
      title: "封面球的 gaze 跟随在浅色主题下偏色",
      status: "settled",
      model: "claude-sonnet-4-5",
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(2),
      tokensUsed: 21_700,
    },
    {
      sessionId: "sess-nh-s2",
      workspace: WS_NH,
      title: "tailwind 3.4 下 beautifului 组件的变量映射",
      status: "settled",
      model: "claude-sonnet-4-5",
      createdAt: hoursAgo(7),
      updatedAt: hoursAgo(6),
      tokensUsed: 15_200,
    },
    {
      sessionId: "sess-nh-s3",
      workspace: WS_NH,
      title: "设置页 mcpServers 读改写的保留语义回归",
      status: "interrupted",
      model: "claude-sonnet-4-5",
      createdAt: daysAgo(1, 20),
      updatedAt: daysAgo(1, 22),
      tokensUsed: 8_600,
    },
    {
      sessionId: "sess-nh-s4",
      workspace: WS_NH,
      title: "usage 热力图按本地时区聚合",
      status: "settled",
      model: "glm-4.6",
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
      tokensUsed: 6_400,
    },
    {
      sessionId: "sess-nh-s5",
      workspace: WS_NH,
      title: "foldTranscript 对 tool result 乱序的容错",
      status: "settled",
      model: "claude-sonnet-4-5",
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
      tokensUsed: 11_000,
    },
    {
      sessionId: "sess-nh-s6",
      workspace: WS_NH,
      title: "讨论 DAG 节点拓扑的 SVG 布局算法",
      status: "settled",
      model: "claude-sonnet-4-5",
      createdAt: daysAgo(12),
      updatedAt: daysAgo(12),
      tokensUsed: 33_000,
    },
    {
      sessionId: "sess-nh-s7",
      workspace: WS_NH,
      title: "v1 归档代码里哪些领域形状值得移植",
      status: "settled",
      model: "claude-sonnet-4-5",
      createdAt: daysAgo(34),
      updatedAt: daysAgo(34),
      tokensUsed: 18_500,
    },
    // archived
    {
      sessionId: "sess-nh-a1",
      workspace: WS_NH,
      title: "旧前端打回前的最后一次样式微调",
      status: "settled",
      model: "claude-sonnet-4-5",
      createdAt: daysAgo(40),
      updatedAt: daysAgo(38),
      archived: true,
      tokensUsed: 9_100,
    },
    {
      sessionId: "sess-nh-a2",
      workspace: WS_NH,
      title: "Tauri sidecar 签名试验",
      status: "settled",
      model: "claude-sonnet-4-5",
      createdAt: daysAgo(45),
      updatedAt: daysAgo(44),
      archived: true,
      tokensUsed: 7_300,
    },

    // --- workspace: dsh-hub ---
    {
      sessionId: BUTLER_DSH,
      workspace: WS_DSH,
      title: "newhorse 会话",
      status: "settled",
      model: "deepseek-chat",
      role: "butler",
      createdAt: daysAgo(9),
      updatedAt: daysAgo(1),
      tokensUsed: 54_000,
    },
    {
      sessionId: "sess-dsh-s1",
      workspace: WS_DSH,
      title: "附件投影缓存的 transformVersion 键设计",
      status: "settled",
      model: "deepseek-chat",
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      tokensUsed: 26_800,
    },
    {
      sessionId: "sess-dsh-s2",
      workspace: WS_DSH,
      title: "预算闸门整张剔除的确定性重放",
      status: "active",
      model: "deepseek-chat",
      createdAt: hoursAgo(30),
      updatedAt: hoursAgo(29),
      tokensUsed: 14_900,
    },

    // --- free tasks (no project / workspace) ---
    {
      sessionId: "sess-free-1",
      workspace: "",
      title: "查看 C 盘根目录文件情况",
      status: "settled",
      model: "glm-4.6-flash",
      createdAt: ago(8),
      updatedAt: ago(4),
      tokensUsed: 1_800,
    },
    {
      sessionId: "sess-free-2",
      workspace: "",
      title: "同步本地 .agents/skills 前端说明",
      status: "active",
      model: "glm-4.6-flash",
      createdAt: hoursAgo(1.5),
      updatedAt: ago(25),
      tokensUsed: 3_200,
    },
    {
      sessionId: "sess-free-3",
      workspace: "",
      title: "收集 github 热点仓库以及 AI 日报",
      status: "settled",
      model: "glm-4.6-flash",
      createdAt: hoursAgo(16),
      updatedAt: hoursAgo(16),
      tokensUsed: 7_600,
    },
  ]
}
