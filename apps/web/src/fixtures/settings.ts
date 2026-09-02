/**
 * Fixture settings echo — RedactedSettings shape exactly (settings-api.ts):
 * redacted provider presets (hasApiKey/apiKeyHint), channels (hasSecret),
 * mcpServers (hasEnv/hasHeaders), memory vector config.
 */
import type { ModelCatalog, SettingsView } from "../api/types"
import { WS_NH } from "./sessions"

export function buildSettings(): SettingsView {
  return {
    agentHome: "C:\\Users\\PC\\.newhorse",
    dataDir: "C:\\Users\\PC\\.newhorse",
    model: "claude-sonnet-4-5",
    contextWindowTokens: 200_000,
    maxOutputTokens: 16_000,
    host: "127.0.0.1",
    port: 3927,
    workspace: WS_NH,
    allowBash: true,
    allowPluginCode: true,
    approvalPolicy: "strict",
    activeProviderId: "prov-anthropic",
    providers: [
      {
        id: "prov-anthropic",
        name: "Anthropic 官方",
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5",
        contextWindowTokens: 200_000,
        maxOutputTokens: 16_000,
        hasApiKey: true,
        apiKeyHint: "…a4f2",
      },
      {
        id: "prov-glm",
        name: "智谱 GLM (OpenAI 兼容)",
        kind: "openai",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-4.6",
        contextWindowTokens: 128_000,
        maxOutputTokens: 8_192,
        hasApiKey: true,
        apiKeyHint: "…91c0",
      },
      {
        id: "prov-deepseek",
        name: "DeepSeek",
        kind: "openai",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        contextWindowTokens: 128_000,
        hasApiKey: false,
      },
      {
        id: "prov-local",
        name: "本地 Ollama",
        kind: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "qwen2.5-coder:7b",
        contextWindowTokens: 32_768,
        hasApiKey: false,
      },
    ],
    provider: {
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      hasApiKey: true,
      apiKeyHint: "…a4f2",
    },
    hasToken: true,
    memory: {
      on: true,
      extraction: true,
      vector: {
        enabled: true,
        mode: "auto",
        embedding: {
          kind: "openai-compatible",
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          model: "embedding-3",
          apiKey: "",
          hasApiKey: true,
          apiKeyHint: "…91c0",
        },
      },
    },
    channels: [
      {
        id: "ch-team-webhook",
        sessionId: "sess-nh-butler",
        webhookUrl: "https://hooks.example.com/services/newhorse/team",
        enabled: true,
        hasSecret: true,
      },
      {
        id: "ch-alerts",
        webhookUrl: "",
        enabled: false,
        hasSecret: false,
      },
    ],
    mcpServers: {
      filesystem: {
        enabled: true,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "G:\\Code\\Agents\\Custom\\newhorse"],
        hasEnv: false,
        hasHeaders: false,
      },
      "remote-github": {
        enabled: true,
        url: "https://mcp.github.com/github",
        hasEnv: false,
        hasHeaders: true,
      },
      postgres: {
        enabled: false,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        hasEnv: true,
        hasHeaders: false,
      },
    },
  }
}

export function buildModels(): { models: string[] } {
  return {
    models: [
      "claude-sonnet-4-5",
      "claude-opus-4-1",
      "claude-haiku-4-5",
      "glm-4.6",
      "glm-4.6-flash",
      "deepseek-chat",
      "qwen2.5-coder:7b",
    ],
  }
}

export function buildCatalog(): ModelCatalog {
  return {
    schemaVersion: 1,
    providers: [
        {
          id: "prov-anthropic",
          models: [
            { id: "claude-sonnet-4-5", kinds: ["chat", "reasoning"], modalities: ["text", "image"], contextWindowTokens: 200_000, maxOutputTokens: 16_000, reasoning: true },
            { id: "claude-opus-4-1", kinds: ["chat", "reasoning"], modalities: ["text", "image"], contextWindowTokens: 200_000, maxOutputTokens: 32_000, reasoning: true },
            { id: "claude-haiku-4-5", kinds: ["chat"], modalities: ["text", "image"], contextWindowTokens: 200_000, maxOutputTokens: 8_192 },
          ],
        },
        {
          id: "prov-glm",
          models: [
            { id: "glm-4.6", kinds: ["chat", "reasoning"], modalities: ["text", "image"], contextWindowTokens: 128_000, reasoning: true },
            { id: "glm-4.6-flash", kinds: ["chat"], modalities: ["text"], contextWindowTokens: 128_000 },
          ],
        },
      ],
  }
}
