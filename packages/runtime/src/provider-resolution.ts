import type { AdapterConfig, ProviderKind } from "@newhorse/llm"

/**
 * Provider resolution seam: turns runtime settings (defaults ← agent-home file
 * ← env ← cli) plus an OPTIONAL explicit profile pointer into the final
 * AdapterConfig + identity used to build an LLM client. This is deliberately
 * separate from the cross-process session registry (`RuntimeSettings.registry`
 * is a SQLite path for the session directory — never a provider registry).
 *
 * Priority mirrors loadRuntimeSettings:
 *   explicit selection > cli > env > active profile > file provider > defaults
 * The selection layer only picks WHICH config to use; secrets stay in the
 * runtime settings and never leak into catalogs/SDK responses.
 */
export interface ProviderSelection {
  /** Explicit profile id (e.g. from a session-create request). Wins over env/cli. */
  readonly profileId?: string
  /** Explicit provider overrides (session-create level, above cli). */
  readonly provider?: Partial<Pick<AdapterConfig, "kind" | "baseUrl" | "apiKey" | "providerId" | "extraHeaders" | "maxRetries">> & { kind?: ProviderKind }
  readonly model?: string
}

export interface ResolvedProvider {
  readonly config: AdapterConfig
  /** Registry provider id resolved for this selection (defaults to kind). */
  readonly providerId: string
  readonly model: string
  /** Where each axis came from — honest attribution for traces/UI. */
  readonly source: {
    readonly profile: string | null
    readonly kind: "selection" | "cli" | "env" | "profile" | "file" | "default"
    readonly model: "selection" | "cli" | "env" | "profile" | "file" | "default"
  }
}

export interface ProviderResolutionInput {
  readonly settings: {
    readonly provider: AdapterConfig
    readonly model: string
    readonly activeProviderId?: string
    readonly providers?: readonly { readonly id: string; readonly name?: string; readonly kind: ProviderKind; readonly baseUrl: string; readonly apiKey?: string; readonly model?: string }[]
  }
  readonly selection?: ProviderSelection
}

/** Resolve the effective provider config. A named profile must exist; a
 *  missing one is a typed error, never a silent fallback to OpenAI. */
export function resolveProviderSelection({ settings, selection }: ProviderResolutionInput): ResolvedProvider {
  const explicitProfile = selection?.profileId
    ? settings.providers?.find((p) => p.id === selection.profileId)
    : undefined
  if (selection?.profileId && !explicitProfile) throw new Error(`provider profile not found: ${selection.profileId}`)

  const activeProfile = settings.activeProviderId
    ? settings.providers?.find((p) => p.id === settings.activeProviderId)
    : undefined

  const base = selection?.provider ?? settings.provider
  const selectionOverrides = selection?.provider
  const profile = explicitProfile ?? activeProfile
  // A selected profile replaces the whole wire config (its kind/baseUrl/key
  // belong together); selection-level fields then override individual axes.
  const config: AdapterConfig = explicitProfile
    ? {
        kind: explicitProfile.kind,
        baseUrl: selectionOverrides?.baseUrl ?? explicitProfile.baseUrl,
        ...(selectionOverrides?.apiKey ? { apiKey: selectionOverrides.apiKey } : explicitProfile.apiKey ? { apiKey: explicitProfile.apiKey } : {}),
        providerId: explicitProfile.id,
      }
    : {
        kind: (base.kind ?? settings.provider.kind) as ProviderKind,
        baseUrl: selectionOverrides?.baseUrl ?? base.baseUrl ?? settings.provider.baseUrl,
        ...(selectionOverrides?.apiKey ? { apiKey: selectionOverrides.apiKey } : base.apiKey ? { apiKey: base.apiKey } : {}),
        ...(base.providerId ? { providerId: base.providerId } : {}),
        ...(base.extraHeaders ? { extraHeaders: base.extraHeaders } : {}),
        ...(base.maxRetries !== undefined ? { maxRetries: base.maxRetries } : {}),
      }
  const model = selection?.model ?? settings.model
  return {
    config,
    providerId: config.providerId ?? config.kind,
    model,
    source: {
      profile: explicitProfile?.id ?? null,
      kind: selectionOverrides ? "selection" : activeProfile ? "profile" : "default",
      model: selection?.model ? "selection" : "env",
    },
  }
}
