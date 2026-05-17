#!/usr/bin/env bun
import cac from 'cac'

import pkg from '../package.json' with { type: 'json' }
import { runExec } from './commands/exec.ts'
import { runHook } from './commands/hook.ts'
import { runInstall, runUninstall } from './commands/install.ts'
import { runList } from './commands/list.ts'

interface ExecOpts {
  agent?: string
  model?: string
  cwd?: string
  timeout?: number
  logFile?: string
  progressFormat?: string
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
    .option('--timeout <ms>', 'Abort backend if it runs longer than this', {
      // @ts-expect-error cac's .d.ts types `type` as `any[]`, but the runtime accepts a bare constructor for single-value coercion.
      type: Number,
    })
    .option(
      '--log-file <path>',
      'Write rendered output to file; stdout becomes a JSON exit envelope',
    )
    .option(
      '--progress-format <format>',
      'Emit raw DispatcherEvents as JSON lines to stderr (only: json)',
    )
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
        timeout: opts.timeout,
        passthrough,
        logFile: opts.logFile,
        progressFormat: opts.progressFormat,
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

  cli
    .command(
      'hook <name>',
      'Run a dispatch hook handler (for use in Claude Code settings)',
    )
    .action(async (name: string) => {
      const exitCode = await runHook(name)
      process.exit(exitCode)
    })

  cli
    .command(
      'install',
      'Install the dispatch PreToolUse hook into Claude Code settings',
    )
    .option('--scope <scope>', 'Target scope: global or project', {
      default: 'global',
    })
    .action(async (opts: { scope: string }) => {
      const scope = opts.scope
      if (scope !== 'global' && scope !== 'project') {
        process.stderr.write(
          `dispatch: install: unknown scope '${scope}'. Use: global, project\n`,
        )
        process.exit(2)
      }
      process.exit(await runInstall(scope))
    })

  cli
    .command(
      'uninstall',
      'Remove the dispatch PreToolUse hook from Claude Code settings',
    )
    .option('--scope <scope>', 'Target scope: global or project', {
      default: 'global',
    })
    .action(async (opts: { scope: string }) => {
      const scope = opts.scope
      if (scope !== 'global' && scope !== 'project') {
        process.stderr.write(
          `dispatch: uninstall: unknown scope '${scope}'. Use: global, project\n`,
        )
        process.exit(2)
      }
      process.exit(await runUninstall(scope))
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
