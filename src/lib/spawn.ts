import type { BuiltCommand } from '../adapters/types.ts'

type FileSink = ReturnType<ReturnType<typeof Bun.file>['writer']>

export interface RunResult {
  exitCode: number
  timedOut: boolean
  idleTimedOut: boolean
}

export interface RunOptions {
  idleTimeoutMs?: number
  onStdout?: (stream: ReadableStream<Uint8Array>) => Promise<void>
}

/**
 * Wraps a ReadableStream with an inactivity watchdog. `onIdle` is called if no
 * chunk arrives within `idleMs` milliseconds. The timer resets on every chunk
 * and is cancelled when the source stream closes normally.
 */
export function wrapWithIdleTimeout(
  source: ReadableStream<Uint8Array>,
  idleMs: number,
  onIdle: () => void,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined

  function resetTimer() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onIdle, idleMs)
    timer.unref?.()
  }

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  resetTimer()

  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        resetTimer()
        controller.enqueue(chunk)
      },
      flush() {
        clearTimer()
      },
    }),
  )
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
    return { exitCode: 127, timedOut: false, idleTimedOut: false }
  }

  const proc = Bun.spawn([resolved, ...built.args], {
    cwd: built.cwd ?? process.cwd(),
    // parallel background callers share one stdin FD — inheriting blocks second+ processes on EOF
    stdin: built.stdinFile ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'inherit',
    env: process.env,
  })

  let timedOut = false
  let idleTimedOut = false
  let stdinFailed = false

  const stdinPromise = built.stdinFile
    ? streamFileToStdin(
        proc.stdin as FileSink | undefined,
        built.stdinFile,
      ).catch((err) => {
        stdinFailed = true
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(
          `dispatch: failed to stream stdin file '${built.stdinFile}': ${msg}\n`,
        )
        proc.kill('SIGTERM')
        setTimeout(() => proc.kill('SIGKILL'), 2_000).unref()
      })
    : Promise.resolve()

  const cleanups = [
    forwardSignal(proc, 'SIGINT'),
    forwardSignal(proc, 'SIGTERM'),
  ]

  try {
    const stdoutStream: ReadableStream<Uint8Array> =
      opts.idleTimeoutMs && opts.idleTimeoutMs > 0 && opts.onStdout
        ? wrapWithIdleTimeout(proc.stdout!, opts.idleTimeoutMs, () => {
            process.stderr.write(
              `dispatch: no output from subprocess for ${opts.idleTimeoutMs}ms — killing\n`,
            )
            timedOut = true
            idleTimedOut = true
            proc.kill('SIGTERM')
            setTimeout(() => proc.kill('SIGKILL'), 2_000).unref()
          })
        : proc.stdout!

    const stdoutPromise = opts.onStdout
      ? opts.onStdout(stdoutStream).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(`dispatch: event stream error: ${msg}\n`)
        })
      : Promise.resolve()
    const [exitCode] = await Promise.all([
      proc.exited,
      stdoutPromise,
      stdinPromise,
    ])

    return {
      exitCode: timedOut ? 124 : stdinFailed ? 1 : exitCode,
      timedOut,
      idleTimedOut,
    }
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
}

async function streamFileToStdin(
  stdin: FileSink | undefined,
  path: string,
): Promise<void> {
  if (!stdin) {
    throw new Error('subprocess stdin pipe is unavailable')
  }

  try {
    for await (const chunk of Bun.file(path).stream()) {
      stdin.write(chunk)
      await stdin.flush()
    }
  } finally {
    await stdin.end()
  }
}

function forwardSignal(
  proc: { kill: (sig: NodeJS.Signals | number) => void },
  signal: NodeJS.Signals,
): () => void {
  const handler = () => proc.kill(signal)
  process.on(signal, handler)
  return () => {
    process.off(signal, handler)
  }
}
