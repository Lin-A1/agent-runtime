import type { AdapterConfig, LlmClient, ProviderKind } from "./adapter"
import { makeLlmClient } from "./adapter"
import type { Fetcher } from "./route"

export interface ModelCapabilities {
  readonly contextWindowTokens?: number
  readonly maxOutputTokens?: number
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] }
  readonly reasoning?: boolean
  readonly toolCalling?: boolean
}

export interface ModelProfile extends ModelCapabilities {
  readonly id: string
  readonly name?: string
  readonly providerId: string
}

export interface ProviderDefinition {
  readonly id: string
  readonly name: string
  readonly kind: ProviderKind
  readonly defaultBaseUrl: string
  readonly capabilities?: Readonly<Record<string, unknown>>
  readonly models?: readonly ModelProfile[]
  /** Executable seam. Metadata-only providers intentionally omit this. */
  readonly createClient?: (config: AdapterConfig, fetch?: Fetcher) => LlmClient
}

export class AdapterUnavailableError extends Error {
  readonly code = "LLM_ADAPTER_UNAVAILABLE"
  readonly providerId: string

  constructor(providerId: string) {
    super(`LLM adapter unavailable for provider: ${providerId}`)
    this.name = "AdapterUnavailableError"
    this.providerId = providerId
  }
}

export interface AdapterRegistry {
  readonly providers: readonly ProviderDefinition[]
  readonly get: (id: string) => ProviderDefinition | undefined
  readonly resolveClient: (provider: string | AdapterConfig) => ProviderDefinition
  readonly createClient: (config: AdapterConfig, fetch?: Fetcher) => LlmClient
  readonly register: (provider: ProviderDefinition) => () => void
}

const builtin = (definition: Omit<ProviderDefinition, "createClient">): ProviderDefinition => ({
  ...definition,
  createClient: (config, fetch) => makeLlmClient({ ...config, kind: definition.kind, providerId: definition.id }, fetch),
})

export const BUILTIN_PROVIDERS: readonly ProviderDefinition[] = [
  builtin({ id: "openai", name: "OpenAI", kind: "openai", defaultBaseUrl: "https://api.openai.com" }),
  builtin({ id: "openai-responses", name: "OpenAI Responses", kind: "openai-responses", defaultBaseUrl: "https://api.openai.com" }),
  builtin({ id: "anthropic", name: "Anthropic", kind: "anthropic", defaultBaseUrl: "https://api.anthropic.com" }),
  builtin({ id: "openai-compatible", name: "OpenAI Compatible", kind: "openai-compatible", defaultBaseUrl: "http://localhost:11434" }),
]

export function createAdapterRegistry(initial: readonly ProviderDefinition[] = BUILTIN_PROVIDERS): AdapterRegistry {
  const entries = new Map<string, ProviderDefinition>()
  for (const provider of initial) {
    if (!provider.id.trim() || entries.has(provider.id)) throw new Error(`Invalid or duplicate provider id: ${provider.id}`)
    entries.set(provider.id, provider)
  }
  const resolveClient = (provider: string | AdapterConfig): ProviderDefinition => {
    const providerId = typeof provider === "string" ? provider : provider.providerId ?? provider.kind
    const definition = entries.get(providerId)
    if (!definition?.createClient) throw new AdapterUnavailableError(providerId)
    return definition
  }
  return {
    get: (id) => entries.get(id),
    resolveClient,
    createClient: (config, fetch) => resolveClient(config).createClient!(config, fetch),
    register: (provider) => {
      if (!provider.id.trim()) throw new Error("Invalid provider id: empty")
      if (entries.has(provider.id)) throw new Error(`Duplicate provider id: ${provider.id}`)
      entries.set(provider.id, provider)
      let active = true
      return () => {
        if (!active) return
        active = false
        if (entries.get(provider.id) === provider) entries.delete(provider.id)
      }
    },
    get providers() { return [...entries.values()] },
  }
}

export function profileToAdapterConfig(profile: { readonly providerId?: string; readonly kind: ProviderKind; readonly baseUrl: string; readonly apiKey?: string; readonly extraHeaders?: Readonly<Record<string, string>>; readonly maxRetries?: number }): AdapterConfig {
  return profile
}
