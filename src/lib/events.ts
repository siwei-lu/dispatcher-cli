import type { Adapter, DispatcherEvent } from '../adapters/types.ts'

type Writer = (s: string) => void

interface RenderOpts {
  writer?: Writer
  errWriter?: Writer
}

function truncate(s: string, max: number): string {
  if (s.length > max) return s.slice(0, max - 1) + '…'
  return s
}

function buildStatsLine(fields: {
  costUsd?: number
  tokens?: number
  durationMs?: number
}): string | null {
  const segments: string[] = []
  if (fields.costUsd !== undefined) {
    segments.push(`cost=$${fields.costUsd.toFixed(4)}`)
  }
  if (fields.tokens !== undefined) {
    segments.push(`${Math.round(fields.tokens / 1000)}k tokens`)
  }
  if (fields.durationMs !== undefined) {
    segments.push(`${(fields.durationMs / 1000).toFixed(1)}s`)
  }
  if (segments.length === 0) return null
  return segments.join(' · ')
}

function emitDone(
  fields: {
    result: string
    costUsd?: number
    tokens?: number
    durationMs?: number
  },
  writer: Writer,
): void {
  const statsLine = buildStatsLine(fields)
  if (statsLine !== null) {
    writer(`[done] ${fields.result}\n${statsLine}\n`)
  } else {
    writer(`[done] ${fields.result}\n`)
  }
}

function renderEvent(
  event: DispatcherEvent,
  writer: Writer,
  errWriter: Writer,
): void {
  switch (event.type) {
    case 'start':
      writer(`[start] ${event.agent} · ${event.model}\n`)
      break
    case 'task':
      writer(`[task] ${truncate(event.prompt, 120)}\n`)
      break
    case 'thinking':
      writer(`[thinking] ${truncate(event.text, 120)}\n`)
      break
    case 'tool':
      writer(`[tool] ${event.name}: ${truncate(event.brief, 80)}\n`)
      break
    case 'done':
      // Caller handles done via pendingDone logic; this branch is unreachable from
      // renderEventStream, but emitDone is called directly there.
      emitDone(event, writer)
      break
    case 'error':
      errWriter(`[error] ${event.message}\n`)
      break
    case 'tool_result':
      // Not rendered to output.
      break
    default:
      break
  }
}

type PendingDone = {
  result: string
  costUsd?: number
  durationMs?: number
  tokens?: number
}

export async function renderEventStream(
  stdout: ReadableStream<Uint8Array>,
  adapter: Adapter,
  opts?: RenderOpts,
): Promise<void> {
  const writer: Writer =
    opts?.writer ?? process.stdout.write.bind(process.stdout)
  const errWriter: Writer =
    opts?.errWriter ?? process.stderr.write.bind(process.stderr)

  const decoder = new TextDecoder('utf-8')
  let leftover = ''
  let pendingDone: PendingDone | null = null

  function processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      errWriter('dispatch: skipped malformed stream-json line\n')
      return
    }

    const event = adapter.parseEvent(parsed)
    if (event === null) return

    if (event.type === 'done') {
      if (pendingDone === null) {
        // First done — buffer it.
        pendingDone = {
          result: event.result,
          costUsd: event.costUsd,
          durationMs: event.durationMs,
          tokens: event.tokens,
        }
      } else {
        // Second done — merge and emit.
        const merged: PendingDone = {
          // Non-empty result wins.
          result: event.result.length > 0 ? event.result : pendingDone.result,
          // First non-undefined wins for costUsd and durationMs.
          costUsd: pendingDone.costUsd ?? event.costUsd,
          durationMs: pendingDone.durationMs ?? event.durationMs,
          // Sum tokens if both present; otherwise whichever is defined.
          tokens:
            pendingDone.tokens !== undefined && event.tokens !== undefined
              ? pendingDone.tokens + event.tokens
              : (pendingDone.tokens ?? event.tokens),
        }
        emitDone(merged, writer)
        pendingDone = null
      }
    } else {
      renderEvent(event, writer, errWriter)
    }
  }

  for await (const chunk of stdout) {
    const text = decoder.decode(chunk, { stream: true })
    const combined = leftover + text
    const lines = combined.split('\n')
    // Last segment is the incomplete line (or empty if chunk ended with \n).
    leftover = lines[lines.length - 1] ?? ''
    for (let i = 0; i < lines.length - 1; i++) {
      processLine(lines[i] ?? '')
    }
  }

  // Flush trailing bytes from the decoder.
  const trailing = decoder.decode()
  if (trailing) {
    leftover = leftover + trailing
  }

  // Process any remaining leftover line.
  if (leftover.trim()) {
    processLine(leftover)
    leftover = ''
  }

  // Flush any buffered pendingDone (e.g. claude emits a single done event).
  if (pendingDone !== null) {
    emitDone(pendingDone, writer)
    pendingDone = null
  }
}

export function emitTaskEvent(prompt: string, writer?: Writer): void {
  const out: Writer = writer ?? process.stdout.write.bind(process.stdout)
  out(`[task] ${truncate(prompt, 120)}\n`)
}
