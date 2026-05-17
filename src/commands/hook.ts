const EXEC_DISPATCH = /(^|[\s;&|])(\.\/)?(dist\/)?dispatch\s+exec(\s|$)/
const EXEC_BUN = /(^|[\s;&|])bun\s+run\s+(dev|start)\s+exec(\s|$)/
const HELP_FLAG = /(^|\s)(-h|--help|--version)(\s|$)/

const BLOCK_REASON =
  'dispatch exec streams events to stdout and may run for minutes. Re-issue this Bash call with run_in_background: true, then attach the Monitor tool to its shell_id and stop when a line matching the regex ^\\[done\\] arrives — that is the unified completion signal for both the claude and codex adapters (see src/lib/events.ts).'

const BLOCK_OUTPUT = JSON.stringify({ decision: 'block', reason: BLOCK_REASON })

export function bashPreHandler(raw: string): string {
  let payload: {
    tool_name?: unknown
    tool_input?: { command?: unknown; run_in_background?: unknown }
  }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return '{}'
  }

  if (typeof payload.tool_name !== 'string' || payload.tool_name !== 'Bash') {
    return '{}'
  }

  if (payload.tool_input?.run_in_background === true) {
    return '{}'
  }

  const cmd = payload.tool_input?.command
  if (typeof cmd !== 'string') {
    return '{}'
  }

  if (!EXEC_DISPATCH.test(cmd) && !EXEC_BUN.test(cmd)) {
    return '{}'
  }

  if (HELP_FLAG.test(cmd)) {
    return '{}'
  }

  return BLOCK_OUTPUT
}

export async function runHook(name: string): Promise<number> {
  if (name === 'bash-pre') {
    const raw = await Bun.stdin.text()
    process.stdout.write(bashPreHandler(raw) + '\n')
    return 0
  }
  process.stderr.write(
    `dispatch: unknown hook '${name}'. Known hooks: bash-pre\n`,
  )
  return 2
}
