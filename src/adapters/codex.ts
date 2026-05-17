import type { Adapter, BuiltCommand, DispatchOptions } from './types.ts'

export const codexAdapter: Adapter = {
  name: 'codex',
  binary: 'codex',

  build(opts: DispatchOptions): BuiltCommand {
    const args: string[] = ['exec', '--skip-git-repo-check']

    if (opts.model) {
      args.push('-m', opts.model)
    }
    if (opts.cwd) {
      args.push('-C', opts.cwd)
    }
    if (opts.output) {
      process.stderr.write(
        `dispatch: --output=${opts.output} is not supported by codex exec; ignoring.\n`,
      )
    }
    if (opts.passthrough.length > 0) {
      args.push(...opts.passthrough)
    }

    args.push(opts.prompt)

    return {
      command: this.binary,
      args,
      cwd: opts.cwd,
    }
  },

  supports(option) {
    return option === 'model' || option === 'cwd'
  },
}
