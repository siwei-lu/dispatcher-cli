import type { BuiltCommand } from '../adapters/types.ts'

export interface RunResult {
  exitCode: number
  timedOut: boolean
}

export interface RunOptions {
  timeoutMs?: number
}

export async function runStreaming(
  built: BuiltCommand,
  opts: RunOptions = {},
): Promise<RunResult> {
  const resolved = Bun.which(built.command)
  if (!resolved) {
    process.stderr.write(
      `dispatch: '${built.command}' was not found on PATH. ` +
        `Install it and try again.\n`,
    )
    return { exitCode: 127, timedOut: false }
  }

  const proc = Bun.spawn([resolved, ...built.args], {
    cwd: built.cwd ?? process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  })

  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 2_000).unref()
    }, opts.timeoutMs)
    timer.unref?.()
  }

  forwardSignal(proc, 'SIGINT')
  forwardSignal(proc, 'SIGTERM')

  const exitCode = await proc.exited
  if (timer) clearTimeout(timer)

  return { exitCode: timedOut ? 124 : exitCode, timedOut }
}

function forwardSignal(
  proc: { kill: (sig: NodeJS.Signals | number) => void },
  signal: NodeJS.Signals,
) {
  const handler = () => proc.kill(signal)
  process.on(signal, handler)
}
