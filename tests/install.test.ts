import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runInstall, runUninstall } from '../src/commands/install.ts'

describe('install / uninstall', () => {
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    origHome = process.env['HOME']
    origCwd = process.cwd()
  })

  afterEach(() => {
    if (origHome !== undefined) {
      process.env['HOME'] = origHome
    } else {
      delete process.env['HOME']
    }
    process.chdir(origCwd)
  })

  it('global install creates settings file with hook entry', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const result = await runInstall('global')
    expect(result).toBe(0)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    const content = JSON.parse(
      require('node:fs').readFileSync(settingsPath, 'utf8'),
    ) as {
      hooks: {
        PreToolUse: Array<{
          matcher: string
          hooks: Array<{ command: string }>
        }>
      }
    }
    const bashBlock = content.hooks.PreToolUse.find((b) => b.matcher === 'Bash')
    expect(bashBlock).toBeDefined()
    expect(
      bashBlock?.hooks.some((h) => h.command === 'dispatch hook bash-pre'),
    ).toBe(true)
  })

  it('global install is idempotent', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const r1 = await runInstall('global')
    expect(r1).toBe(0)

    const output: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') output.push(chunk)
      return true
    }

    const r2 = await runInstall('global')
    process.stdout.write = origWrite

    expect(r2).toBe(0)
    expect(output.some((line) => line.includes('already configured'))).toBe(
      true,
    )
  })

  it('global install + uninstall round-trip removes the file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    await runInstall('global')
    const r = await runUninstall('global')
    expect(r).toBe(0)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    expect(require('node:fs').existsSync(settingsPath)).toBe(false)
  })

  it('project install works inside a git repo', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    Bun.spawnSync(['git', 'init'], {
      cwd: tmpDir,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    process.chdir(tmpDir)

    const result = await runInstall('project')
    expect(result).toBe(0)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    const content = JSON.parse(
      require('node:fs').readFileSync(settingsPath, 'utf8'),
    ) as {
      hooks: {
        PreToolUse: Array<{
          matcher: string
          hooks: Array<{ command: string }>
        }>
      }
    }
    const bashBlock = content.hooks.PreToolUse.find((b) => b.matcher === 'Bash')
    expect(
      bashBlock?.hooks.some((h) => h.command === 'dispatch hook bash-pre'),
    ).toBe(true)
  })

  it('project install returns 2 outside a git repo', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    // No git init — but we need to ensure it's truly not inside any git repo
    // by using a deeply nested temp path that is isolated
    const isolated = mkdtempSync(join(tmpDir, 'isolated-'))
    process.chdir(isolated)

    const errors: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') errors.push(chunk)
      return true
    }

    const result = await runInstall('project')
    process.stderr.write = origWrite

    expect(result).toBe(2)
    expect(errors.some((e) => e.includes('git repository'))).toBe(true)
  })

  it('sibling entry preservation: install adds our entry, uninstall removes only ours', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'my-other-tool' }],
              },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    )

    const r1 = await runInstall('global')
    expect(r1).toBe(0)

    const afterInstall = JSON.parse(
      require('node:fs').readFileSync(settingsPath, 'utf8'),
    ) as {
      hooks: {
        PreToolUse: Array<{
          matcher: string
          hooks: Array<{ command: string }>
        }>
      }
    }
    const bashBlock = afterInstall.hooks.PreToolUse.find(
      (b) => b.matcher === 'Bash',
    )
    expect(bashBlock?.hooks.length).toBe(2)
    expect(bashBlock?.hooks.some((h) => h.command === 'my-other-tool')).toBe(
      true,
    )
    expect(
      bashBlock?.hooks.some((h) => h.command === 'dispatch hook bash-pre'),
    ).toBe(true)

    const r2 = await runUninstall('global')
    expect(r2).toBe(0)

    const afterUninstall = JSON.parse(
      require('node:fs').readFileSync(settingsPath, 'utf8'),
    ) as {
      hooks: {
        PreToolUse: Array<{
          matcher: string
          hooks: Array<{ command: string }>
        }>
      }
    }
    const bashBlockAfter = afterUninstall.hooks.PreToolUse.find(
      (b) => b.matcher === 'Bash',
    )
    expect(bashBlockAfter?.hooks.length).toBe(1)
    expect(bashBlockAfter?.hooks[0]?.command).toBe('my-other-tool')
  })

  it('malformed JSON returns 1', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(settingsPath, 'bad json')

    const result = await runInstall('global')
    expect(result).toBe(1)
  })

  it('uninstall when not configured returns 0', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const result = await runUninstall('global')
    expect(result).toBe(0)
  })

  it('project uninstall returns 2 outside a git repo', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    const isolated = mkdtempSync(join(tmpDir, 'isolated-'))
    process.chdir(isolated)

    const errors: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') errors.push(chunk)
      return true
    }

    const result = await runUninstall('project')
    process.stderr.write = origWrite

    expect(result).toBe(2)
    expect(errors.some((e) => e.includes('git repository'))).toBe(true)
  })

  it('uninstall with malformed JSON returns 1', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(settingsPath, 'bad json')

    const result = await runUninstall('global')
    expect(result).toBe(1)
  })

  it('install returns 1 when settings JSON is a top-level string', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(settingsPath, '"a string"')

    const result = await runInstall('global')
    expect(result).toBe(1)
  })

  it('install returns 1 when settings JSON has hooks as a non-object', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({ hooks: 'not-an-object' }))

    const result = await runInstall('global')
    expect(result).toBe(1)
  })

  it('install returns 1 when settings JSON has PreToolUse as a non-array', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { PreToolUse: 'not-an-array' } }),
    )

    const result = await runInstall('global')
    expect(result).toBe(1)
  })

  it('install does not crash when a PreToolUse block has no hooks array', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash' }] },
      }),
    )

    const result = await runInstall('global')
    expect(result).toBe(0)

    // The malformed block must still be present, and our new block must be appended
    const content = JSON.parse(
      require('node:fs').readFileSync(settingsPath, 'utf8'),
    ) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks?: unknown }> }
    }
    const blocks = content.hooks.PreToolUse
    // malformed block is preserved
    expect(blocks.some((b) => b.matcher === 'Bash' && !('hooks' in b))).toBe(
      true,
    )
    // our new block was appended
    expect(
      blocks.some(
        (b) =>
          b.matcher === 'Bash' &&
          Array.isArray(b.hooks) &&
          (b.hooks as Array<{ command?: string }>).some(
            (h) => h.command === 'dispatch hook bash-pre',
          ),
      ),
    ).toBe(true)
  })

  it('sibling byte-identity: install+uninstall leaves sibling entry unchanged', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-test-'))
    process.env['HOME'] = tmpDir

    const siblingEntry = { type: 'command', command: 'my-other-tool' }
    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    await mkdir(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [{ matcher: 'Bash', hooks: [{ ...siblingEntry }] }],
          },
        },
        null,
        2,
      ) + '\n',
    )

    const siblingBefore = JSON.stringify(siblingEntry)

    await runInstall('global')
    await runUninstall('global')

    const afterUninstall = JSON.parse(
      require('node:fs').readFileSync(settingsPath, 'utf8'),
    ) as {
      hooks: {
        PreToolUse: Array<{ matcher: string; hooks: Array<unknown> }>
      }
    }
    const bashBlock = afterUninstall.hooks.PreToolUse.find(
      (b) => b.matcher === 'Bash',
    )
    expect(bashBlock?.hooks.length).toBe(1)
    expect(JSON.stringify(bashBlock?.hooks[0])).toBe(siblingBefore)
  })
})
