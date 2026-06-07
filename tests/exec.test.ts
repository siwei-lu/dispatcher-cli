import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { runExec } from '../src/commands/exec.ts'

const fakeCodexScript = `#!/bin/sh
if [ -n "$DISPATCH_FAKE_STDIN_FILE" ]; then
  cat > "$DISPATCH_FAKE_STDIN_FILE"
else
  cat >/dev/null
fi
if [ -n "$DISPATCH_FAKE_ARGS_FILE" ]; then
  printf '%s\\n' "$@" > "$DISPATCH_FAKE_ARGS_FILE"
fi
printf '%s\\n' \\
  '{"type":"thread.started","thread_id":"t1"}' \\
  '{"type":"item.started","item":{"id":"i0","type":"command_execution","command":"echo final"}}' \\
  '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"final answer"}}' \\
  '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}'
`

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

describe('runExec — --prompt-file validation', () => {
  it('returns 1 when --prompt-file does not exist', async () => {
    const captured = captureProcessWrites()
    const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-prompt-missing-'))
    try {
      const missingPath = join(tmpDir, 'missing-prompt.txt')
      const code = await runExec({
        promptFile: missingPath,
        agent: 'codex',
        passthrough: [],
      })

      expect(code).toBe(1)
      expect(captured.stdout.join('')).toBe('')
      expect(captured.stderr.join('')).toContain(
        `dispatch: --prompt-file: file does not exist: ${missingPath}`,
      )
    } finally {
      captured.restore()
      rmSync(tmpDir, { recursive: true, force: true })
    }
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

describe('runExec — --output validation', () => {
  it('returns 2 for unknown --output value', async () => {
    const captured = captureProcessWrites()
    try {
      const code = await runExec({
        prompt: 'test',
        agent: 'codex',
        passthrough: [],
        output: 'xml',
      })

      expect(code).toBe(2)
      expect(captured.stdout.join('')).toBe('')
      expect(captured.stderr.join('')).toContain(
        "dispatch: --output: unknown format 'xml'. Use: result, json",
      )
    } finally {
      captured.restore()
    }
  })
})

describe('runExec — stdout/stderr routing', () => {
  it('writes only final result text to stdout and progress to stderr by default', async () => {
    await withFakeCodex(async (tmpDir) => {
      const result = await runDispatchExec(
        ['-a', 'codex', 'review this diff'],
        tmpDir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('final answer')
      expect(result.stderr).toContain('[task] review this diff')
      expect(result.stderr).toContain('[start] codex')
      expect(result.stderr).toContain('[tool] shell: echo final')
      expect(result.stderr).toContain('[done] final answer')
    })
  })

  it('writes JSON to stdout only when --output=json is set', async () => {
    await withFakeCodex(async (tmpDir) => {
      const result = await runDispatchExec(
        ['-a', 'codex', '--output', 'json', 'review this diff'],
        tmpDir,
      )

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        status: 'ok',
        exitCode: 0,
        summary: 'final answer',
      })
      expect(result.stderr).toContain('[done] final answer')
    })
  })

  it('decouples --log-file from JSON stdout', async () => {
    await withFakeCodex(async (tmpDir) => {
      const logFile = join(tmpDir, 'dispatch.log')
      const result = await runDispatchExec(
        ['-a', 'codex', '--log-file', logFile, 'review this diff'],
        tmpDir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('final answer')
      expect(result.stderr).not.toContain('[task]')
      expect(result.stderr).not.toContain('[done]')
      const log = readFileSync(logFile, 'utf8')
      expect(log).toContain('[task] review this diff')
      expect(log).toContain('[done] final answer')
    })
  })

  it('includes log in the JSON envelope when --log-file and --output=json are combined', async () => {
    await withFakeCodex(async (tmpDir) => {
      const logFile = join(tmpDir, 'dispatch.log')
      const result = await runDispatchExec(
        [
          '-a',
          'codex',
          '--log-file',
          logFile,
          '--output',
          'json',
          'review this diff',
        ],
        tmpDir,
      )

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        status: 'ok',
        exitCode: 0,
        summary: 'final answer',
        log: resolve(logFile),
      })
      expect(result.stderr).not.toContain('[task]')
      expect(readFileSync(logFile, 'utf8')).toContain('[done] final answer')
    })
  })

  it('sources the task prompt from --prompt-file and streams it to codex stdin', async () => {
    await withFakeCodex(async (tmpDir) => {
      const promptText = 'review this prompt from a file'
      const promptFile = join(tmpDir, 'prompt.txt')
      const stdinCapture = join(tmpDir, 'stdin.txt')
      const argsCapture = join(tmpDir, 'args.txt')
      writeFileSync(promptFile, promptText)

      const result = await runDispatchExec(
        ['-a', 'codex', '--prompt-file', promptFile],
        tmpDir,
        {
          DISPATCH_FAKE_STDIN_FILE: stdinCapture,
          DISPATCH_FAKE_ARGS_FILE: argsCapture,
        },
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('final answer')
      expect(result.stderr).toContain(`[task] ${promptText}`)
      expect(readFileSync(stdinCapture, 'utf8')).toBe(promptText)
      expect(readFileSync(argsCapture, 'utf8').trim().split('\n')).toEqual([
        'exec',
        '--json',
        '--ephemeral',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
      ])
    })
  })
})

async function withFakeCodex<T>(
  fn: (tmpDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-exec-'))
  const binPath = join(tmpDir, 'codex')
  writeFileSync(binPath, fakeCodexScript)
  chmodSync(binPath, 0o755)

  try {
    return await fn(tmpDir)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function runDispatchExec(
  args: string[],
  pathPrefix: string,
  extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const path =
    process.env.PATH === undefined
      ? pathPrefix
      : `${pathPrefix}${delimiter}${process.env.PATH}`
  const proc = Bun.spawn([process.execPath, 'src/index.ts', 'exec', ...args], {
    cwd: resolve(import.meta.dir, '..'),
    env: {
      ...process.env,
      ...extraEnv,
      PATH: path,
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  return { exitCode, stdout, stderr }
}

function captureProcessWrites(): {
  stdout: string[]
  stderr: string[]
  restore: () => void
} {
  const stdout: string[] = []
  const stderr: string[] = []
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  process.stdout.write = captureWrite(stdout)
  process.stderr.write = captureWrite(stderr) as typeof process.stderr.write

  return {
    stdout,
    stderr,
    restore() {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
    },
  }
}

function captureWrite(output: string[]): typeof process.stdout.write {
  return ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output.push(
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk),
    )
    const callback = args.find(
      (arg): arg is (err?: Error) => void => typeof arg === 'function',
    )
    callback?.()
    return true
  }) as typeof process.stdout.write
}
