import { describe, expect, it } from 'bun:test'

import { claudeAdapter } from '../src/adapters/claude.ts'
import { codexAdapter } from '../src/adapters/codex.ts'
import { resolveAdapter } from '../src/adapters/registry.ts'

describe('claude adapter', () => {
  it('always emits -p --output-format stream-json --verbose --no-session-persistence with prompt last', () => {
    const built = claudeAdapter.build({
      prompt: 'hello world',
      passthrough: [],
    })
    expect(built.command).toBe('claude')
    expect(built.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      'hello world',
    ])
  })

  it('inserts --model after the structured flags, before passthrough and prompt', () => {
    const built = claudeAdapter.build({
      prompt: 'go',
      model: 'sonnet',
      passthrough: [],
    })
    expect(built.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--model',
      'sonnet',
      'go',
    ])
  })

  it('inserts passthrough args before the prompt', () => {
    const built = claudeAdapter.build({
      prompt: 'go',
      passthrough: ['--verbose', '--debug'],
    })
    expect(built.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--verbose',
      '--debug',
      'go',
    ])
  })

  it('forwards cwd', () => {
    const built = claudeAdapter.build({
      prompt: 'go',
      cwd: '/tmp/work',
      passthrough: [],
    })
    expect(built.cwd).toBe('/tmp/work')
  })

  describe('parseEvent', () => {
    it('maps system.init to a start event', () => {
      expect(
        claudeAdapter.parseEvent({
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-7',
        }),
      ).toEqual({ type: 'start', agent: 'claude', model: 'claude-opus-4-7' })
    })

    it('filters system.hook_* events', () => {
      expect(
        claudeAdapter.parseEvent({ type: 'system', subtype: 'hook_started' }),
      ).toBeNull()
    })

    it('filters rate_limit_event', () => {
      expect(claudeAdapter.parseEvent({ type: 'rate_limit_event' })).toBeNull()
    })

    it('maps assistant tool_use block to a tool event', () => {
      const ev = claudeAdapter.parseEvent({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
          ],
        },
      })
      expect(ev).toMatchObject({ type: 'tool', name: 'Bash' })
      expect((ev as { brief: string }).brief).toContain('ls')
    })

    it('maps assistant thinking block to a thinking event', () => {
      expect(
        claudeAdapter.parseEvent({
          type: 'assistant',
          message: {
            content: [{ type: 'thinking', thinking: 'pondering...' }],
          },
        }),
      ).toEqual({ type: 'thinking', text: 'pondering...' })
    })

    it('maps result to a done event with cost/duration/tokens', () => {
      expect(
        claudeAdapter.parseEvent({
          type: 'result',
          is_error: false,
          result: '42',
          total_cost_usd: 0.01,
          duration_ms: 1200,
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      ).toEqual({
        type: 'done',
        result: '42',
        costUsd: 0.01,
        durationMs: 1200,
        tokens: 6,
      })
    })

    it('returns null for unknown event types', () => {
      expect(
        claudeAdapter.parseEvent({ type: 'unknown_future_event' }),
      ).toBeNull()
    })

    it('truncates tool brief longer than 80 chars', () => {
      const longCmd = 'a'.repeat(90)
      const ev = claudeAdapter.parseEvent({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: longCmd } },
          ],
        },
      })
      expect((ev as { brief: string }).brief.length).toBeLessThanOrEqual(80)
    })
  })
})

describe('codex adapter', () => {
  it('always emits exec --json --ephemeral --skip-git-repo-check with prompt last', () => {
    const built = codexAdapter.build({
      prompt: 'hello',
      passthrough: [],
    })
    expect(built.command).toBe('codex')
    expect(built.args).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      'hello',
    ])
  })

  it('maps --model to -m and --cwd to -C, after --json --ephemeral --skip-git-repo-check', () => {
    const built = codexAdapter.build({
      prompt: 'go',
      model: 'o4',
      cwd: '/tmp/x',
      passthrough: [],
    })
    expect(built.args).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-m',
      'o4',
      '-C',
      '/tmp/x',
      'go',
    ])
    expect(built.cwd).toBe('/tmp/x')
  })

  it('inserts passthrough args before the prompt (duplicates accepted)', () => {
    const built = codexAdapter.build({
      prompt: 'go',
      passthrough: ['--ephemeral'],
    })
    expect(built.args).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--ephemeral',
      'go',
    ])
  })

  it('supports model and cwd options', () => {
    expect(codexAdapter.supports('model')).toBe(true)
    expect(codexAdapter.supports('cwd')).toBe(true)
  })

  describe('parseEvent', () => {
    it('maps thread.started to a start event with empty model', () => {
      expect(
        codexAdapter.parseEvent({
          type: 'thread.started',
          thread_id: '019e3680-bbd0-78d0-a10b-f8b3bc8c55a1',
        }),
      ).toEqual({ type: 'start', agent: 'codex', model: '' })
    })

    it('drops turn.started (returns null)', () => {
      expect(codexAdapter.parseEvent({ type: 'turn.started' })).toBeNull()
    })

    it('maps item.completed with agent_message to a done event with result text', () => {
      // Real probe shape: {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"2"}}
      expect(
        codexAdapter.parseEvent({
          type: 'item.completed',
          item: { id: 'item_0', type: 'agent_message', text: '2' },
        }),
      ).toEqual({
        type: 'done',
        result: '2',
        costUsd: undefined,
        durationMs: undefined,
        tokens: undefined,
      })
    })

    it('maps turn.completed with usage to a done event with tokens (input+output only)', () => {
      // Real probe shape: {"type":"turn.completed","usage":{"input_tokens":22386,"cached_input_tokens":9600,"output_tokens":18,"reasoning_output_tokens":16}}
      // Only input_tokens + output_tokens are summed; cached and reasoning are ignored.
      expect(
        codexAdapter.parseEvent({
          type: 'turn.completed',
          usage: {
            input_tokens: 22386,
            cached_input_tokens: 9600,
            output_tokens: 18,
            reasoning_output_tokens: 16,
          },
        }),
      ).toEqual({
        type: 'done',
        result: '',
        costUsd: undefined,
        durationMs: undefined,
        tokens: 22404,
      })
    })

    it('maps item.started with command_execution to a tool event', () => {
      // Real probe shape: {"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'ls -la /tmp'",...}}
      // command_execution items are handled at item.started (tool firing); item.completed is dropped.
      const ev = codexAdapter.parseEvent({
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/bin/zsh -lc 'ls -la /tmp'",
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress',
        },
      })
      expect(ev).toEqual({
        type: 'tool',
        name: 'shell',
        brief: "/bin/zsh -lc 'ls -la /tmp'",
      })
    })

    it('truncates tool brief longer than 80 chars', () => {
      const longCmd = 'a'.repeat(90)
      const ev = codexAdapter.parseEvent({
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: longCmd,
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress',
        },
      })
      expect(ev).not.toBeNull()
      expect((ev as { brief: string }).brief.length).toBeLessThanOrEqual(80)
    })

    it('drops item.completed for command_execution (avoid double-emit)', () => {
      expect(
        codexAdapter.parseEvent({
          type: 'item.completed',
          item: {
            id: 'item_0',
            type: 'command_execution',
            command: "/bin/zsh -lc 'ls'",
            aggregated_output: 'file1\nfile2\n',
            exit_code: 0,
            status: 'completed',
          },
        }),
      ).toBeNull()
    })

    it('returns null for unknown event types', () => {
      expect(
        codexAdapter.parseEvent({ type: 'unknown_future_event' }),
      ).toBeNull()
    })
  })
})

describe('registry', () => {
  it('resolves known agents case-insensitively', () => {
    expect(resolveAdapter('claude').name).toBe('claude')
    expect(resolveAdapter('CODEX').name).toBe('codex')
  })

  it('throws a helpful error for unknown agents', () => {
    expect(() => resolveAdapter('gemini')).toThrow(/Unknown agent/)
  })
})
