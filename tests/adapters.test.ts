import { describe, expect, it } from 'bun:test'

import { claudeAdapter } from '../src/adapters/claude.ts'
import { codexAdapter } from '../src/adapters/codex.ts'
import { resolveAdapter } from '../src/adapters/registry.ts'

describe('claude adapter', () => {
  it('builds a `-p` invocation with the prompt as last positional', () => {
    const built = claudeAdapter.build({
      prompt: 'hello world',
      passthrough: [],
    })
    expect(built.command).toBe('claude')
    expect(built.args).toEqual(['-p', 'hello world'])
  })

  it('maps --model', () => {
    const built = claudeAdapter.build({
      prompt: 'go',
      model: 'sonnet',
      passthrough: [],
    })
    expect(built.args).toEqual(['-p', '--model', 'sonnet', 'go'])
  })

  it('inserts passthrough args before the prompt', () => {
    const built = claudeAdapter.build({
      prompt: 'go',
      passthrough: ['--verbose', '--debug'],
    })
    expect(built.args).toEqual(['-p', '--verbose', '--debug', 'go'])
  })

  it('forwards cwd', () => {
    const built = claudeAdapter.build({
      prompt: 'go',
      cwd: '/tmp/work',
      passthrough: [],
    })
    expect(built.cwd).toBe('/tmp/work')
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
