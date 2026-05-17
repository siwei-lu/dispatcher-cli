import { claudeAdapter } from './claude.ts'
import { codexAdapter } from './codex.ts'
import type { Adapter } from './types.ts'

export const adapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
}

export const adapterNames = Object.keys(adapters)

export function resolveAdapter(name: string): Adapter {
  const normalized = name.toLowerCase()
  const adapter = adapters[normalized]
  if (!adapter) {
    const available = adapterNames.join(', ')
    throw new Error(`Unknown agent '${name}'. Available agents: ${available}.`)
  }
  return adapter
}
