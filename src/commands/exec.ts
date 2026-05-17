import { resolveAdapter } from '../adapters/registry.ts'
import type { OutputFormat } from '../adapters/types.ts'
import { defaultAgent, defaultModel } from '../lib/config.ts'
import { runStreaming } from '../lib/spawn.ts'
import { readStdin } from '../lib/stdin.ts'

export interface ExecArgs {
  prompt?: string
  agent?: string
  model?: string
  cwd?: string
  output?: string
  timeout?: number
  passthrough: string[]
}

const VALID_FORMATS: OutputFormat[] = ['text', 'json', 'stream-json']

export async function runExec(args: ExecArgs): Promise<number> {
  const agentName = args.agent ?? defaultAgent()
  const adapter = resolveAdapter(agentName)

  const prompt = args.prompt ?? (await readStdin()).trim()
  if (!prompt) {
    process.stderr.write(
      'dispatch: no prompt provided. Pass it as an argument or via stdin.\n',
    )
    return 2
  }

  let output: OutputFormat | undefined
  if (args.output) {
    if (!VALID_FORMATS.includes(args.output as OutputFormat)) {
      process.stderr.write(
        `dispatch: invalid --output '${args.output}'. ` +
          `Expected one of: ${VALID_FORMATS.join(', ')}.\n`,
      )
      return 2
    }
    output = args.output as OutputFormat
  }

  const built = adapter.build({
    prompt,
    model: args.model ?? defaultModel(),
    cwd: args.cwd,
    output,
    passthrough: args.passthrough,
  })

  const { exitCode } = await runStreaming(built, { timeoutMs: args.timeout })
  return exitCode
}
