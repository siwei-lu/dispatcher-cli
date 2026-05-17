import { describe, expect, it } from 'bun:test'

import { runExec } from '../src/commands/exec.ts'

describe('runExec — --log-file parent-dir check', () => {
  it('returns 1 when --log-file parent dir does not exist', async () => {
    const code = await runExec({
      prompt: 'test',
      agent: 'codex',
      passthrough: [],
      logFile: '/nonexistent/dir/abc.log',
    })
    expect(code).toBe(1)
  })
})

describe('runExec — --progress-format validation', () => {
  it('returns 2 for unknown --progress-format value', async () => {
    const code = await runExec({
      prompt: 'test',
      agent: 'codex',
      passthrough: [],
      progressFormat: 'xml',
    })
    expect(code).toBe(2)
  })
})
