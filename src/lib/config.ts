import { adapterNames } from '../adapters/registry.ts'

export interface ResolvedDefaults {
  agent: string
  model: string | undefined
}

export function defaultAgent(): string {
  const env = process.env.DISPATCH_AGENT?.toLowerCase()
  if (env && adapterNames.includes(env)) return env

  if (Bun.which('claude')) return 'claude'
  if (Bun.which('codex')) return 'codex'

  return 'claude'
}

export function defaultModel(): string | undefined {
  return process.env.DISPATCH_MODEL || undefined
}
