import { useSyncExternalStore } from "react"
import { createBuiltinProviders } from "./providers"
import type { WorkbenchActionResult, WorkbenchProvider, WorkbenchProviderContext, WorkbenchTab } from "./types"

const providers = new Map<string, WorkbenchProvider>(
  createBuiltinProviders().map((provider) => [provider.resource.id, provider]),
)
const listeners = new Set<() => void>()
let snapshot = [...providers.values()]

function notify(): void {
  snapshot = [...providers.values()]
  for (const listener of listeners) listener()
}

export function getWorkbenchProviders(): readonly WorkbenchProvider[] {
  return snapshot
}

export function subscribeWorkbenchProviders(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWorkbenchProviders(): readonly WorkbenchProvider[] {
  return useSyncExternalStore(subscribeWorkbenchProviders, getWorkbenchProviders, getWorkbenchProviders)
}

/** Register one host/plugin/MCP resource and return a disposer for hot unload. */
export function registerWorkbenchProvider(provider: WorkbenchProvider): () => void {
  const previous = providers.get(provider.resource.id)
  providers.set(provider.resource.id, provider)
  notify()
  return () => {
    if (providers.get(provider.resource.id) !== provider) return
    if (previous) providers.set(provider.resource.id, previous)
    else providers.delete(provider.resource.id)
    notify()
  }
}

export function registerWorkbenchProviders(next: readonly WorkbenchProvider[]): () => void {
  const disposers = next.map((provider) => registerWorkbenchProvider(provider))
  return () => disposers.reverse().forEach((dispose) => dispose())
}

export async function executeWorkbenchAction(
  providerId: string,
  action: string,
  input: unknown,
  context: WorkbenchProviderContext,
): Promise<WorkbenchActionResult> {
  const provider = providers.get(providerId)
  if (!provider) return { ok: false, error: `未注册工作台资源：${providerId}` }
  if (provider.resource.state !== "ready") return { ok: false, error: `资源尚未就绪：${providerId}` }
  if (!provider.actions?.includes(action)) return { ok: false, error: `资源不支持操作：${action}` }
  if (!provider.execute) return { ok: false, error: `资源尚未提供操作实现：${action}` }
  try {
    return await provider.execute(action, input, context)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export type { WorkbenchActionResult, WorkbenchProviderContext, WorkbenchTab }
