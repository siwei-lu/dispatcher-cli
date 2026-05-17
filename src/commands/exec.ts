import { resolveAdapter } from '../adapters/registry.ts'
import { defaultAgent, defaultModel } from '../lib/config.ts'
import { emitTaskEvent, renderEventStream } from '../lib/events.ts'
import { runStreaming } from '../lib/spawn.ts'
import { readStdin } from '../lib/stdin.ts'

export interface ExecArgs {
  prompt?: string
  agent?: string
  model?: string
  cwd?: string
  timeout?: number
  passthrough: string[]
}

export async function runExec(args: ExecArgs): Promise<number> {
  const agentName = args.agent ?? defaultAgent()
  let adapter
  try {
    adapter = resolveAdapter(agentName)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`dispatch: ${message}\n`)
    return 2
  }

  const prompt = args.prompt ?? (await readStdin()).trim()
  if (!prompt) {
    process.stderr.write(
      'dispatch: no prompt provided. Pass it as an argument or via stdin.\n',
    )
    return 2
  }

  emitTaskEvent(prompt)

  const built = adapter.build({
    prompt,
    model: args.model ?? defaultModel(),
    cwd: args.cwd,
    passthrough: args.passthrough,
  })

  const { exitCode } = await runStreaming(built, {
    timeoutMs: args.timeout,
    onStdout: (stream) => renderEventStream(stream, adapter),
  })
  return exitCode
}
