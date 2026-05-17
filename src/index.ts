#!/usr/bin/env bun
import cac from 'cac'

import pkg from '../package.json' with { type: 'json' }
import { runExec } from './commands/exec.ts'
import { runList } from './commands/list.ts'

interface ExecOpts {
  agent?: string
  model?: string
  cwd?: string
  output?: string
  timeout?: number
}

function splitPassthrough(argv: string[]): {
  cliArgs: string[]
  passthrough: string[]
} {
  const idx = argv.indexOf('--')
  if (idx === -1) return { cliArgs: argv, passthrough: [] }
  return {
    cliArgs: argv.slice(0, idx),
    passthrough: argv.slice(idx + 1),
  }
}

async function main(): Promise<number> {
  const raw = process.argv.slice(2)
  const { cliArgs, passthrough } = splitPassthrough(raw)

  const cli = cac('dispatch')

  cli
    .command(
      'exec [...prompt]',
      'Run a non-interactive prompt against an AI coding agent',
    )
    .option('-a, --agent <name>', 'Agent backend (claude|codex)')
    .option('-m, --model <model>', 'Model identifier passed to the backend')
    .option('-C, --cwd <dir>', 'Working directory for the spawned process')
    .option(
      '-o, --output <format>',
      'Output format: text|json|stream-json (claude only)',
    )
    .option('--timeout <ms>', 'Abort backend if it runs longer than this', {
      type: [Number],
    })
    .example('dispatch exec -a claude "explain this repo"')
    .example('echo "summarize README" | dispatch exec -a codex')
    .example('dispatch exec -a claude -- --verbose "debug me"')
    .action(async (promptParts: string[], opts: ExecOpts) => {
      const prompt = promptParts.length > 0 ? promptParts.join(' ') : undefined
      const exitCode = await runExec({
        prompt,
        agent: opts.agent,
        model: opts.model,
        cwd: opts.cwd,
        output: opts.output,
        timeout: opts.timeout,
        passthrough,
      })
      process.exit(exitCode)
    })

  cli
    .command('list', 'Show available agent backends and their status')
    .alias('ls')
    .action(async () => {
      const exitCode = await runList()
      process.exit(exitCode)
    })

  cli.help()
  cli.version(pkg.version)

  try {
    const parsed = cli.parse(['bun', 'dispatch', ...cliArgs], { run: false })

    if (parsed.options.help || parsed.options.version) return 0

    const matched = cli.matchedCommand
    if (!matched || matched.name === '') {
      if (cliArgs.length === 0) {
        cli.outputHelp()
        return 0
      }
      const cmd = parsed.args[0] ?? cliArgs[0]
      process.stderr.write(
        `dispatch: Unknown command '${cmd}'. ` +
          `Run 'dispatch --help' for usage.\n`,
      )
      return 1
    }

    await cli.runMatchedCommand()
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`dispatch: ${message}\n`)
    return 1
  }
}

const exitCode = await main()
process.exit(exitCode)
