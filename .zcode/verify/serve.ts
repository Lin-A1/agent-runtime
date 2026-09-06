import { createServer } from "G:/Code/Agents/Custom/newhorse/packages/server/src/server"
import { loadRuntimeSettings, writeAgentHomeConfig, createApprovalHub } from "@newhorse/runtime"

// Verification server v2: adds the settings controller (provider/model config).
const AGENT_HOME = "C:/Users/PC/.zcode/cli/tmp/nh-verify/home"
const sse = (text: string): Response =>
  new Response([
    "data: " + JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" }, finish_reason: null }] }) + "\n\n",
    "data: " + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] }) + "\n\n",
    "data: [DONE]\n\n",
  ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } })

// ApprovalDock verification: return an ask_user tool call first (question
// queue), then a final text reply after the user settles it.
let call = 0
const askSse = (): Response =>
  new Response([
    "data: " + JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" }, finish_reason: null }] }) + "\n\n",
    "data: " + JSON.stringify({ choices: [{ delta: { role: "assistant", content: "", tool_calls: [{ index: 0, id: "call_probe", type: "function", function: { name: "ask_user", arguments: "{\"question\": \"probe: 请选择部署环境\", \"options\": [\"staging\", \"production\"]}" } }] }, finish_reason: "tool_calls" }] }) + "\n\n",
    "data: [DONE]\n\n",
  ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } })

const env = { ...process.env, AGENT_RUNTIME_HOME: AGENT_HOME, NEWHORSE_DATA_DIR: "C:/Users/PC/.zcode/cli/tmp/nh-verify/data", NEWHORSE_WORKSPACE: "C:/Users/PC/.zcode/cli/tmp/nh-verify/projects/demo" }
const approvals = createApprovalHub()
const handle = await createServer({
  port: 18923,
  uiDir: "G:/Code/Agents/Custom/newhorse/apps/web/dist",
  dataDir: "C:/Users/PC/.zcode/cli/tmp/nh-verify/data",
  agentHome: AGENT_HOME,
  approvals,
  settings: {
    get: () => loadRuntimeSettings({ env }),
    write: async (patch) => {
      await writeAgentHomeConfig(AGENT_HOME, patch)
      return loadRuntimeSettings({ env })
    },
  },
  sessionConfig: (create) => ({
    asButler: create?.asButler === true,
    provider: { kind: "openai", baseUrl: "http://127.0.0.1:9", apiKey: "mock", providerId: "mock-gw" },
    model: "demo-model",
    workspace: "C:/Users/PC/.zcode/cli/tmp/nh-verify/projects/demo",
    dataDir: "C:/Users/PC/.zcode/cli/tmp/nh-verify/data",
    enableBash: true,
    fetch: (async () => { call++; return call === 1 ? askSse() : sse("用户已选择 staging，继续。") }) as never,
  }),
})
console.log("verify server v2 ready at", handle.baseUrl)
