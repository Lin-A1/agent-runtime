import { describe, expect, it } from "bun:test"
import { resolveProviderSelection } from "./provider-resolution"

const settings = {
  provider: { kind: "openai" as const, baseUrl: "https://file.example", apiKey: "file-key" },
  model: "file-model",
  activeProviderId: "preset-a",
  providers: [
    { id: "preset-a", name: "Preset A", kind: "anthropic" as const, baseUrl: "https://a.example", apiKey: "a-key", model: "claude-x" },
    { id: "custom-gw", name: "Custom GW", kind: "openai-compatible" as const, baseUrl: "https://gw.example", apiKey: "gw-key" },
  ],
}

describe("provider resolution", () => {
  it("keeps resolved settings when no selection is given", () => {
    const resolved = resolveProviderSelection({ settings })
    expect(resolved.config).toEqual({ kind: "openai", baseUrl: "https://file.example", apiKey: "file-key" })
    expect(resolved.providerId).toBe("openai")
    expect(resolved.model).toBe("file-model")
    expect(resolved.source.profile).toBeNull()
  })

  it("resolves an explicit profile and maps its registry id", () => {
    const resolved = resolveProviderSelection({ settings, selection: { profileId: "custom-gw" } })
    expect(resolved.config.kind).toBe("openai-compatible")
    expect(resolved.config.baseUrl).toBe("https://gw.example")
    expect(resolved.config.apiKey).toBe("gw-key")
    expect(resolved.config.providerId).toBe("custom-gw")
    expect(resolved.providerId).toBe("custom-gw")
  })

  it("throws a typed error for a missing profile instead of falling back", () => {
    expect(() => resolveProviderSelection({ settings, selection: { profileId: "nope" } })).toThrow("provider profile not found: nope")
  })

  it("selection-level provider/model overrides win without touching the profile key", () => {
    const resolved = resolveProviderSelection({ settings, selection: { profileId: "custom-gw", provider: { baseUrl: "https://override.example" }, model: "m-override" } })
    expect(resolved.config.baseUrl).toBe("https://override.example")
    expect(resolved.config.providerId).toBe("custom-gw")
    expect(resolved.model).toBe("m-override")
  })
})
