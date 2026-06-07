export interface DispatchOptions {
  prompt: string
  promptFile?: string
  model?: string
  cwd?: string
  passthrough: string[]
}

export interface BuiltCommand {
  command: string
  args: string[]
  cwd?: string
  stdinFile?: string
}

export type DispatcherEvent =
  | { type: 'start'; agent: string; model: string }
  | { type: 'task'; prompt: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; brief: string }
  | { type: 'tool_result'; ok: boolean }
  | {
      type: 'done'
      result: string
      costUsd?: number
      durationMs?: number
      tokens?: number
    }
  | { type: 'error'; message: string }

export interface Adapter {
  readonly name: string
  readonly binary: string
  build(opts: DispatchOptions): BuiltCommand
  supports(option: 'model' | 'cwd'): boolean
  parseEvent(event: unknown): DispatcherEvent | null
}
