export type OutputFormat = 'text' | 'json' | 'stream-json'

export interface DispatchOptions {
  prompt: string
  model?: string
  cwd?: string
  output?: OutputFormat
  passthrough: string[]
}

export interface BuiltCommand {
  command: string
  args: string[]
  cwd?: string
}

export interface Adapter {
  readonly name: string
  readonly binary: string
  build(opts: DispatchOptions): BuiltCommand
  supports(option: 'output' | 'model' | 'cwd'): boolean
}
