#!/usr/bin/env bun
import cac from 'cac'

import pkg from '../package.json' with { type: 'json' }
import { runExec } from './commands/exec.ts'
import type { ExecArgs } from './commands/exec.ts'
import { runHook } from './commands/hook.ts'
import { runInstall, runUninstall } from './commands/install.ts'
import { runList } from './commands/list.ts'
import { runUpdate } from './commands/update.ts'

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
    .option('--prompt-file <path>', 'Read prompt from a file')
    .option(
      '--idle-timeout <ms>',
      'Kill backend if it produces no output for this long (useful for codex/gpt-5.5 stream stalls)',
      {
        // @ts-expect-error cac's .d.ts types `type` as `any[]`, but the runtime accepts a bare constructor for single-value coercion.
        type: Number,
      },
    )
    .option('--log-file <path>', 'Write rendered progress to file')
    .option(
      '--output <format>',
      'Stdout format: result or json (default: result)',
    )
    .option(
      '--progress-format <format>',
      'Emit raw DispatcherEvents as JSON lines to stderr (only: json)',
    )
    .example('dispatch exec -a claude "explain this repo"')
    .example('echo "summarize README" | dispatch exec -a codex')
    .example('dispatch exec -a claude -- --verbose "debug me"')
    .action(
      async (
        promptParts: string[],
        opts: Partial<Omit<ExecArgs, 'prompt' | 'passthrough'>>,
      ) => {
        const prompt =
          promptParts.length > 0 ? promptParts.join(' ') : undefined
        const exitCode = await runExec({
          prompt,
          promptFile: opts.promptFile,
          agent: opts.agent,
          model: opts.model,
          cwd: opts.cwd,
          idleTimeout: opts.idleTimeout,
          passthrough,
          logFile: opts.logFile,
          output: opts.output,
          progressFormat: opts.progressFormat,
        })
        process.exit(exitCode)
      },
    )

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

  cli
    .command('update', 'Check for and install a new dispatch binary release')
    .option('--check', 'Print update status only; never write to disk')
    .option(
      '--version <tag>',
      'Download and install a specific release tag (e.g. v0.6.0)',
    )
    .option('--prerelease', 'Include prerelease tags when resolving latest')
    .action(
      async (opts: {
        check: boolean
        version?: string
        prerelease: boolean
      }) => {
        process.exit(
          await runUpdate({
            check: opts.check ?? false,
            version: opts.version,
            prerelease: opts.prerelease ?? false,
          }),
        )
      },
    )

  cli.help()

  const hasSubcommand = cliArgs.length > 0 && !cliArgs[0]?.startsWith('-')
  if (
    !hasSubcommand &&
    (cliArgs.includes('--version') || cliArgs.includes('-v'))
  ) {
    process.stdout.write(pkg.version + '\n')
    return 0
  }

  try {
    const parsed = cli.parse(['bun', 'dispatch', ...cliArgs], { run: false })

    if (parsed.options.help) return 0

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
