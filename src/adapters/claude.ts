import type { Adapter, BuiltCommand, DispatchOptions } from './types.ts'

export const claudeAdapter: Adapter = {
  name: 'claude',
  binary: 'claude',

  build(opts: DispatchOptions): BuiltCommand {
    const args: string[] = ['-p']

    if (opts.model) {
      args.push('--model', opts.model)
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

  parseEvent(_event) {
    return null
  },
}
