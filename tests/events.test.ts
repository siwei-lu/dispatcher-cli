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
