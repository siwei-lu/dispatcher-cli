import type {
  Adapter,
  BuiltCommand,
  DispatchOptions,
  DispatcherEvent,
} from './types.ts'

export const codexAdapter: Adapter = {
  name: 'codex',
  binary: 'codex',

  build(opts: DispatchOptions): BuiltCommand {
    const args: string[] = ['exec', '--json', '--skip-git-repo-check']

    if (opts.model) {
      args.push('-m', opts.model)
    }
    if (opts.cwd) {
      args.push('-C', opts.cwd)
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
      case 'thread.started':
        // Probe shape: {"type":"thread.started","thread_id":"..."}
        // codex does not surface the model name in events; emit empty string.
        return { type: 'start', agent: 'codex', model: '' }

      case 'turn.started':
        // Redundant with thread.started — drop it.
        return null

      case 'item.started': {
        // command_execution items are emitted as both item.started and item.completed.
        // We map item.started → tool event (tool is firing) and item.completed →
        // null for command_execution (avoid double-emitting).
        const item = ev['item']
        if (!item || typeof item !== 'object') return null
        const it = item as Record<string, unknown>

        if (it['type'] === 'command_execution') {
          // name = 'shell' (codex uses a built-in shell tool; no explicit name field)
          let brief = String(it['command'] ?? '')
          if (brief.length > 80) brief = brief.slice(0, 79) + '…'
          return { type: 'tool', name: 'shell', brief }
        }
        return null
      }

      case 'item.completed': {
        // Probe shape for agent_message:
        //   {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"2"}}
        // Note: codex uses `text`, not `content`.
        //
        // Probe shape for command_execution:
        //   {"type":"item.completed","item":{...,"type":"command_execution",...}}
        // We handle command_execution in item.started to avoid double-emit; drop here.
        const item = ev['item']
        if (!item || typeof item !== 'object') return null
        const it = item as Record<string, unknown>

        if (it['type'] === 'agent_message') {
          const text = String(it['text'] ?? it['content'] ?? '')
          return {
            type: 'done',
            result: text,
            costUsd: undefined,
            durationMs: undefined,
            tokens: undefined,
          }
        }
        return null
      }

      case 'turn.completed': {
        // Probe shape:
        //   {"type":"turn.completed","usage":{"input_tokens":22386,"cached_input_tokens":9600,"output_tokens":18,"reasoning_output_tokens":16}}
        // Sum only input_tokens + output_tokens (ignore cached/reasoning per spec).
        const usage = ev['usage']
        let tokens: number | undefined
        if (usage && typeof usage === 'object') {
          const u = usage as Record<string, unknown>
          const inp =
            typeof u['input_tokens'] === 'number' ? u['input_tokens'] : 0
          const out =
            typeof u['output_tokens'] === 'number' ? u['output_tokens'] : 0
          tokens = inp + out
        }
        return {
          type: 'done',
          result: '',
          costUsd: undefined,
          durationMs: undefined,
          tokens,
        }
      }

      default:
        return null
    }
  },
}
