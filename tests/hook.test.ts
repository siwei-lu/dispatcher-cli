import { describe, expect, it } from 'bun:test'

import { bashPreHandler, runHook } from '../src/commands/hook.ts'

function makeInput(
  command: string,
  opts: { run_in_background?: boolean } = {},
): string {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command, ...opts },
  })
}

describe('bashPreHandler', () => {
  it('blocks dispatch exec -a claude hi', () => {
    const out = bashPreHandler(makeInput('dispatch exec -a claude hi'))
    const parsed = JSON.parse(out) as { decision: string; reason: string }
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toContain('run_in_background')
  })

  it('passes through when run_in_background is true', () => {
    const out = bashPreHandler(
      makeInput('dispatch exec -a claude hi', { run_in_background: true }),
    )
    expect(out).toBe('{}')
  })

  it('passes through dispatch list (not an exec command)', () => {
    expect(bashPreHandler(makeInput('dispatch list'))).toBe('{}')
  })

  it('passes through dispatch exec --help', () => {
    expect(bashPreHandler(makeInput('dispatch exec --help'))).toBe('{}')
  })

  it('blocks bun run dev exec hi', () => {
    const out = bashPreHandler(makeInput('bun run dev exec hi'))
    const parsed = JSON.parse(out) as { decision: string }
    expect(parsed.decision).toBe('block')
  })

  it('blocks bun run start exec hi', () => {
    const out = bashPreHandler(makeInput('bun run start exec hi'))
    const parsed = JSON.parse(out) as { decision: string }
    expect(parsed.decision).toBe('block')
  })

  it('passes through a non-Bash tool', () => {
    const out = bashPreHandler(
      JSON.stringify({ tool_name: 'Read', tool_input: {} }),
    )
    expect(out).toBe('{}')
  })

  it('passes through malformed JSON', () => {
    expect(bashPreHandler('not json')).toBe('{}')
  })

  it('blocks ./dispatch exec foo (relative path prefix)', () => {
    const out = bashPreHandler(makeInput('./dispatch exec foo'))
    const parsed = JSON.parse(out) as { decision: string }
    expect(parsed.decision).toBe('block')
  })

  it('blocks ./dist/dispatch exec foo (dist/ prefix)', () => {
    const out = bashPreHandler(makeInput('./dist/dispatch exec foo'))
    const parsed = JSON.parse(out) as { decision: string }
    expect(parsed.decision).toBe('block')
  })

  it('passes through when tool_input is present but command field is missing', () => {
    const out = bashPreHandler(
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { run_in_background: false },
      }),
    )
    expect(out).toBe('{}')
  })
})

describe('runHook', () => {
  it('returns 2 for an unknown hook name', async () => {
    const errors: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') errors.push(chunk)
      return true
    }

    const result = await runHook('unknown-name')
    process.stderr.write = origWrite

    expect(result).toBe(2)
    expect(errors.some((e) => e.includes('unknown hook'))).toBe(true)
  })
})
