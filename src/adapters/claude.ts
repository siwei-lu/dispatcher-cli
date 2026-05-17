import type {
  Adapter,
  BuiltCommand,
  DispatchOptions,
  DispatcherEvent,
} from './types.ts'

export const claudeAdapter: Adapter = {
  name: 'claude',
  binary: 'claude',

  build(opts: DispatchOptions): BuiltCommand {
    const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose']

    if (opts.model) {
      args.push('--model', opts.model)
    }
    if (opts.passthrough.length > 0) {
      args.push(...opts.passthrough)
    }

    args.push(opts.prompt)

    return {
      command: this.binary,
      args,
      cwd: opts.cwd,
    }
  },

  supports(option) {
    return option === 'model' || option === 'cwd'
  },

  parseEvent(event: unknown): DispatcherEvent | null {
    if (!event || typeof event !== 'object') return null
    const ev = event as Record<string, unknown>

    switch (ev['type']) {
      case 'system': {
        if (ev['subtype'] === 'init') {
          return {
            type: 'start',
            agent: 'claude',
            model: String(ev['model'] ?? ''),
          }
        }
        return null
      }

      case 'rate_limit_event':
        return null

      case 'assistant': {
        const msg = ev['message']
        if (!msg || typeof msg !== 'object') return null
        const content = (msg as Record<string, unknown>)['content']
        if (!Array.isArray(content)) return null

        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          const b = block as Record<string, unknown>

          if (b['type'] === 'tool_use') {
            const name = String(b['name'] ?? 'unknown')
            const input = b['input']
            let brief: string
            if (input && typeof input === 'object') {
              const inp = input as Record<string, unknown>
              brief =
                typeof inp['command'] === 'string'
                  ? inp['command']
                  : JSON.stringify(input)
            } else {
              brief = String(input ?? '')
            }
            if (brief.length > 80) brief = brief.slice(0, 79) + '…'
            return { type: 'tool', name, brief }
          }

          if (b['type'] === 'thinking') {
            return { type: 'thinking', text: String(b['thinking'] ?? '') }
          }
        }
        return null
      }

      case 'result': {
        const result = String(ev['result'] ?? '')
        const costUsd =
          typeof ev['total_cost_usd'] === 'number'
            ? ev['total_cost_usd']
            : undefined
        const durationMs =
          typeof ev['duration_ms'] === 'number' ? ev['duration_ms'] : undefined
        let tokens: number | undefined
        const usage = ev['usage']
        if (usage && typeof usage === 'object') {
          const u = usage as Record<string, unknown>
          const inp =
            typeof u['input_tokens'] === 'number' ? u['input_tokens'] : 0
          const out =
            typeof u['output_tokens'] === 'number' ? u['output_tokens'] : 0
          tokens = inp + out
        }
        return { type: 'done', result, costUsd, durationMs, tokens }
      }

      default:
        return null
    }
  },
}
