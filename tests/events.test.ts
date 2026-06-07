import { describe, expect, it } from 'bun:test'

import { claudeAdapter } from '../src/adapters/claude.ts'
import { codexAdapter } from '../src/adapters/codex.ts'
import { emitTaskEvent, renderEventStream } from '../src/lib/events.ts'

function makeStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

describe('renderEventStream — claude transcript', () => {
  it('renders start, thinking, tool, done, and stats in order', async () => {
    const jsonl = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-7',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'Let me compute this.' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'echo $((1+1))' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'result',
        result: '2',
        total_cost_usd: 0.0012,
        duration_ms: 3400,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    ].join('\n')

    const lines: string[] = []
    const writer = (s: string) => lines.push(...s.split('\n').filter(Boolean))

    await renderEventStream(makeStream(jsonl), claudeAdapter, { writer })

    // 1. A line starting with [start] claude
    const startLine = lines.find((l) => l.startsWith('[start] claude'))
    expect(startLine).toBeDefined()

    // 2. A line starting with [thinking]
    const thinkingLine = lines.find((l) => l.startsWith('[thinking]'))
    expect(thinkingLine).toBeDefined()

    // 3. A line starting with [tool] Bash:
    const toolLine = lines.find((l) => l.startsWith('[tool] Bash:'))
    expect(toolLine).toBeDefined()

    // 4. A line starting with [done] 2
    const doneLine = lines.find((l) => l.startsWith('[done] 2'))
    expect(doneLine).toBeDefined()

    // 5. A stats line containing cost=, tokens, and s
    const statsLine = lines.find(
      (l) => l.includes('cost=') && l.includes('tokens') && l.includes('s'),
    )
    expect(statsLine).toBeDefined()

    // Order: start < thinking < tool < done < stats
    const idxStart = lines.findIndex((l) => l.startsWith('[start] claude'))
    const idxThinking = lines.findIndex((l) => l.startsWith('[thinking]'))
    const idxTool = lines.findIndex((l) => l.startsWith('[tool] Bash:'))
    const idxDone = lines.findIndex((l) => l.startsWith('[done] 2'))
    const idxStats = lines.findIndex(
      (l) => l.includes('cost=') && l.includes('tokens') && l.includes('s'),
    )
    expect(idxStart).toBeLessThan(idxThinking)
    expect(idxThinking).toBeLessThan(idxTool)
    expect(idxTool).toBeLessThan(idxDone)
    expect(idxDone).toBeLessThan(idxStats)
  })
})

describe('renderEventStream — default writers', () => {
  it('routes rendered progress to stderr when no writer is provided', async () => {
    const jsonl = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-7',
      }),
      JSON.stringify({
        type: 'result',
        result: 'ok',
      }),
    ].join('\n')

    const captured = captureProcessWrites()
    try {
      await renderEventStream(makeStream(jsonl), claudeAdapter)

      expect(captured.stdout.join('')).toBe('')
      expect(captured.stderr.join('')).toContain('[start] claude')
      expect(captured.stderr.join('')).toContain('[done] ok')
    } finally {
      captured.restore()
    }
  })
})

describe('renderEventStream — codex transcript', () => {
  it('merges two done events into exactly one [done] line', async () => {
    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({
        type: 'item.started',
        item: { id: 'i0', type: 'command_execution', command: 'ls /tmp' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'i0', type: 'command_execution', command: 'ls /tmp' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'i1',
          type: 'agent_message',
          text: 'files are listed',
        },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 100, output_tokens: 5 },
      }),
    ].join('\n')

    const lines: string[] = []
    const writer = (s: string) => lines.push(...s.split('\n').filter(Boolean))

    await renderEventStream(makeStream(jsonl), codexAdapter, { writer })

    // 1. A line starting with [start] codex
    const startLine = lines.find((l) => l.startsWith('[start] codex'))
    expect(startLine).toBeDefined()

    // 2. A line starting with [tool] shell:
    const toolLine = lines.find((l) => l.startsWith('[tool] shell:'))
    expect(toolLine).toBeDefined()

    // 3. Exactly ONE line starting with [done]
    const doneLines = lines.filter((l) => l.startsWith('[done]'))
    expect(doneLines.length).toBe(1)

    // 4. The [done] line contains 'files are listed'
    expect(doneLines[0]).toContain('files are listed')

    // 5. A stats line containing 'tokens'
    const statsLine = lines.find((l) => l.includes('tokens'))
    expect(statsLine).toBeDefined()
  })
})

describe('renderEventStream — malformed JSON', () => {
  it('skips malformed lines without aborting; errWriter receives one call', async () => {
    const jsonl =
      '{"type":"system","subtype":"init","model":"m"}\nNOT_JSON\n{"type":"result","result":"ok"}\n'

    const outLines: string[] = []
    const errMessages: string[] = []
    const writer = (s: string) =>
      outLines.push(...s.split('\n').filter(Boolean))
    const errWriter = (s: string) => errMessages.push(s)

    await renderEventStream(makeStream(jsonl), claudeAdapter, {
      writer,
      errWriter,
    })

    // errWriter received exactly one call containing 'skipped malformed'
    expect(errMessages.length).toBe(1)
    expect(errMessages[0]).toContain('skipped malformed')

    // The start event was still rendered
    const startLine = outLines.find((l) => l.startsWith('[start]'))
    expect(startLine).toBeDefined()
  })
})

describe('emitTaskEvent', () => {
  it('writes a [task] line with the given prompt', () => {
    const written: string[] = []
    emitTaskEvent('explain this repo', (s) => written.push(s))

    expect(written.length).toBe(1)
    expect(written[0]).toMatch(/^\[task\] explain this repo/)
  })

  it('truncates prompts longer than 120 chars', () => {
    const longPrompt = 'x'.repeat(200)
    const written: string[] = []
    emitTaskEvent(longPrompt, (s) => written.push(s))

    // Output is [task] + space + truncated text + \n
    // truncated text is 120 chars (119 + ellipsis)
    const text = written[0]?.slice('[task] '.length).trimEnd()
    expect(text?.length).toBeLessThanOrEqual(120)
    expect(text?.endsWith('…')).toBe(true)
  })

  it('writes to stderr by default', () => {
    const captured = captureProcessWrites()
    try {
      emitTaskEvent('explain this repo')

      expect(captured.stdout.join('')).toBe('')
      expect(captured.stderr.join('')).toMatch(/^\[task\] explain this repo/)
    } finally {
      captured.restore()
    }
  })
})

describe('renderEventStream — truncation', () => {
  it('does NOT truncate the result in a [done] line', async () => {
    const longResult = 'r'.repeat(200)
    const jsonl = JSON.stringify({
      type: 'result',
      result: longResult,
      total_cost_usd: 0.001,
      duration_ms: 1000,
      usage: { input_tokens: 10, output_tokens: 10 },
    })

    const lines: string[] = []
    const writer = (s: string) => lines.push(...s.split('\n').filter(Boolean))

    await renderEventStream(makeStream(jsonl), claudeAdapter, { writer })

    const doneLine = lines.find((l) => l.startsWith('[done]'))
    expect(doneLine).toBeDefined()
    // [done] + space + 200 r's — must contain the full result
    expect(doneLine).toContain(longResult)
  })
})

describe('renderEventStream — return value', () => {
  it('returns PendingDone when a done event is present', async () => {
    const jsonl = JSON.stringify({
      type: 'result',
      result: 'all done',
      total_cost_usd: 0.001,
      duration_ms: 500,
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const result = await renderEventStream(makeStream(jsonl), claudeAdapter, {
      writer: () => {},
    })
    expect(result).not.toBeNull()
    expect(result?.result).toBe('all done')
  })

  it('returns null when stream has no done event', async () => {
    const jsonl = JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-7',
    })
    const result = await renderEventStream(makeStream(jsonl), claudeAdapter, {
      writer: () => {},
    })
    expect(result).toBeNull()
  })
})

describe('renderEventStream — jsonWriter', () => {
  it('calls jsonWriter with a JSON line for each parsed event', async () => {
    const jsonl = JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-7',
    })

    const jsonLines: string[] = []
    await renderEventStream(makeStream(jsonl), claudeAdapter, {
      writer: () => {},
      jsonWriter: (s) => jsonLines.push(s),
    })

    expect(jsonLines.length).toBeGreaterThan(0)
    const parsed = JSON.parse(jsonLines[0]!.trim())
    expect(parsed).toHaveProperty('type')
  })

  it('calls jsonWriter for done events before emitting the [done] render line', async () => {
    const jsonl = JSON.stringify({
      type: 'result',
      result: 'finished',
      total_cost_usd: 0.001,
      duration_ms: 500,
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    const log: string[] = []
    await renderEventStream(makeStream(jsonl), claudeAdapter, {
      writer: (s) => log.push('render:' + s.trimEnd()),
      jsonWriter: (s) => {
        try {
          const ev = JSON.parse(s.trim())
          log.push('json:' + ev.type)
        } catch {
          log.push('json:?')
        }
      },
    })

    const jsonDoneIdx = log.indexOf('json:done')
    const renderDoneIdx = log.findIndex((e) => e.startsWith('render:[done]'))
    expect(jsonDoneIdx).toBeGreaterThanOrEqual(0)
    expect(renderDoneIdx).toBeGreaterThanOrEqual(0)
    expect(jsonDoneIdx).toBeLessThan(renderDoneIdx)
  })
})

function captureProcessWrites(): {
  stdout: string[]
  stderr: string[]
  restore: () => void
} {
  const stdout: string[] = []
  const stderr: string[] = []
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  process.stdout.write = captureWrite(stdout)
  process.stderr.write = captureWrite(stderr) as typeof process.stderr.write

  return {
    stdout,
    stderr,
    restore() {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
    },
  }
}

function captureWrite(output: string[]): typeof process.stdout.write {
  return ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output.push(
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk),
    )
    const callback = args.find(
      (arg): arg is (err?: Error) => void => typeof arg === 'function',
    )
    callback?.()
    return true
  }) as typeof process.stdout.write
}
