import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { resolveAdapter } from '../adapters/registry.ts'
import { defaultAgent, defaultModel } from '../lib/config.ts'
import { emitTaskEvent, renderEventStream } from '../lib/events.ts'
import type { PendingDone } from '../lib/events.ts'
import { runStreaming } from '../lib/spawn.ts'
import { readStdin } from '../lib/stdin.ts'

export interface ExecArgs {
  prompt?: string
  promptFile?: string
  agent?: string
  model?: string
  cwd?: string
  idleTimeout?: number
  passthrough: string[]
  logFile?: string
  output?: string
  progressFormat?: string
}

type OutputFormat = 'result' | 'json'

export async function runExec(args: ExecArgs): Promise<number> {
  // Log-file parent-dir check FIRST — must precede resolveAdapter
  const resolvedLogFile =
    args.logFile !== undefined ? resolve(args.logFile) : undefined
  if (resolvedLogFile !== undefined) {
    const parentDir = dirname(resolvedLogFile)
    if (!existsSync(parentDir)) {
      process.stderr.write(
        `dispatch: --log-file: parent directory does not exist: ${parentDir}\n`,
      )
      return 1
    }
  }

  const resolvedPromptFile =
    args.promptFile !== undefined ? resolve(args.promptFile) : undefined
  if (resolvedPromptFile !== undefined && !existsSync(resolvedPromptFile)) {
    process.stderr.write(
      `dispatch: --prompt-file: file does not exist: ${resolvedPromptFile}\n`,
    )
    return 1
  }

  // progress-format validation
  if (args.progressFormat !== undefined && args.progressFormat !== 'json') {
    process.stderr.write(
      `dispatch: --progress-format: unknown format '${args.progressFormat}'. Only 'json' is supported.\n`,
    )
    return 2
  }

  const rawOutputFormat = args.output ?? 'result'
  if (rawOutputFormat !== 'result' && rawOutputFormat !== 'json') {
    process.stderr.write(
      `dispatch: --output: unknown format '${rawOutputFormat}'. Use: result, json\n`,
    )
    return 2
  }
  const outputFormat: OutputFormat = rawOutputFormat

  const agentName = args.agent ?? defaultAgent()
  let adapter
  try {
    adapter = resolveAdapter(agentName)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`dispatch: ${message}\n`)
    return 2
  }

  let prompt: string
  if (resolvedPromptFile !== undefined) {
    try {
      prompt = await Bun.file(resolvedPromptFile).text()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(
        `dispatch: --prompt-file: failed to read ${resolvedPromptFile}: ${message}\n`,
      )
      return 1
    }
  } else {
    prompt = args.prompt ?? (await readStdin()).trim()
  }
  if (!prompt) {
    process.stderr.write(
      'dispatch: no prompt provided. Pass it as an argument or via stdin.\n',
    )
    return 2
  }

  const MAX_ATTEMPTS = 4
  const RETRY_DELAY_MS = 60_000
  const effectiveIdleTimeout =
    args.idleTimeout === 0 ? undefined : (args.idleTimeout ?? 300_000)

  let logSink: ReturnType<ReturnType<typeof Bun.file>['writer']> | undefined
  let logWriter: ((s: string) => void) | undefined
  if (resolvedLogFile !== undefined) {
    logSink = Bun.file(resolvedLogFile).writer()
    logWriter = (s: string) => logSink!.write(s)
  }

  emitTaskEvent(prompt, logWriter)

  const built = adapter.build({
    prompt,
    promptFile: resolvedPromptFile,
    model: args.model ?? defaultModel(),
    cwd: args.cwd,
    passthrough: args.passthrough,
  })

  const jsonWriter =
    args.progressFormat === 'json'
      ? (s: string) => process.stderr.write(s)
      : undefined

  let capturedDone = null as PendingDone | null
  let exitCode = 0
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let hadOutput = false
    const runResult = await runStreaming(built, {
      idleTimeoutMs: effectiveIdleTimeout,
      onStdout: async (stream) => {
        const outputStream = stream.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              if (!hadOutput) hadOutput = true
              controller.enqueue(chunk)
            },
          }),
        )
        capturedDone = await renderEventStream(outputStream, adapter, {
          writer: logWriter,
          jsonWriter,
        })
      },
    })
    const result = { ...runResult, hadOutput }
    exitCode = result.exitCode

    if (!result.idleTimedOut || result.hadOutput || attempt === MAX_ATTEMPTS) {
      if (
        result.idleTimedOut &&
        !result.hadOutput &&
        attempt === MAX_ATTEMPTS
      ) {
        process.stderr.write(
          `dispatch: idle timeout after ${MAX_ATTEMPTS} attempts — giving up\n`,
        )
      }
      break
    }

    process.stderr.write(
      `dispatch: idle timeout (${effectiveIdleTimeout}ms, no output) — retrying in 60s [attempt ${
        attempt + 1
      }/${MAX_ATTEMPTS}]\n`,
    )
    await Bun.sleep(RETRY_DELAY_MS)
  }

  if (logSink !== undefined) {
    await logSink.flush()
    logSink.end()
  }

  const summary = capturedDone?.result ?? ''
  if (outputFormat === 'json') {
    const envelope: {
      status: 'ok' | 'error'
      exitCode: number
      summary: string
      log?: string
    } = {
      status: exitCode === 0 ? 'ok' : 'error',
      exitCode,
      summary,
    }
    if (resolvedLogFile !== undefined) {
      envelope.log = resolvedLogFile
    }
    process.stdout.write(JSON.stringify(envelope) + '\n')
  } else {
    process.stdout.write(summary)
  }

  return exitCode
}
