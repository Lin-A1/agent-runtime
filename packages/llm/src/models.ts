import type { AdapterConfig } from "./adapter"
import { normalizeBaseUrl } from "./adapter"
import type { Fetcher } from "./route"

export interface ModelDiscoveryResult {
  readonly ids: string[]
  readonly supported: boolean
  readonly status?: number
}

export async function discoverModels(config: AdapterConfig, fetch: Fetcher = globalThis.fetch): Promise<ModelDiscoveryResult> {
  const headers: Record<string, string> = config.kind === "anthropic"
    ? { ...(config.apiKey ? { "x-api-key": config.apiKey } : {}), "anthropic-version": "2023-06-01", ...(config.extraHeaders ?? {}) }
    : { ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}), ...(config.extraHeaders ?? {}) }
  try {
    const res = await fetch(normalizeBaseUrl(config.baseUrl) + "/v1/models", { headers })
    if (!res.ok) return { ids: [], supported: true, status: res.status }
    const body = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string }>; has_more?: boolean }
    const ids = [...(body.data ?? body.models ?? [])].map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0)
    return { ids: [...new Set(ids)].sort(), supported: true, status: res.status }
  } catch {
    return { ids: [], supported: false }
  }
}

export async function listModels(config: AdapterConfig, fetch: Fetcher = globalThis.fetch): Promise<string[]> {
  return (await discoverModels(config, fetch)).ids
}
