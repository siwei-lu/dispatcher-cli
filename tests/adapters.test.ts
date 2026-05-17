import { describe, expect, it } from 'bun:test'

import { claudeAdapter } from '../src/adapters/claude.ts'
import { codexAdapter } from '../src/adapters/codex.ts'
import { resolveAdapter } from '../src/adapters/registry.ts'

describe('claude adapter', () => {
  it('always emits -p --output-format stream-json --verbose with prompt last', () => {
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
  it('uses `exec --skip-git-repo-check` and appends the prompt last', () => {
    const built = codexAdapter.build({
      prompt: 'hello',
      passthrough: [],
    })
    expect(built.command).toBe('codex')
    expect(built.args).toEqual(['exec', '--skip-git-repo-check', 'hello'])
  })

  it('maps --model to -m and --cwd to -C', () => {
    const built = codexAdapter.build({
      prompt: 'go',
      model: 'o4',
      cwd: '/tmp/x',
      passthrough: [],
    })
    expect(built.args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '-m',
      'o4',
      '-C',
      '/tmp/x',
      'go',
    ])
    expect(built.cwd).toBe('/tmp/x')
  })

  it('inserts passthrough args before the prompt', () => {
    const built = codexAdapter.build({
      prompt: 'go',
      passthrough: ['--ephemeral'],
    })
    expect(built.args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      'go',
    ])
  })

  it('supports model and cwd options', () => {
    expect(codexAdapter.supports('model')).toBe(true)
    expect(codexAdapter.supports('cwd')).toBe(true)
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
