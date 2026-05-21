import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { runStreaming, wrapWithIdleTimeout } from '../src/lib/spawn.ts'

// ── wrapWithIdleTimeout unit tests ────────────────────────────────────────────

describe('wrapWithIdleTimeout', () => {
  it('calls onIdle when no chunk arrives before the deadline', async () => {
    const hanging = new ReadableStream<Uint8Array>({ start() {} })

    let fired = false
    const wrapped = wrapWithIdleTimeout(hanging, 60, () => {
      fired = true
    })

    // Start reading (will never yield a chunk)
    const reader = wrapped.getReader()
    const readPromise = reader.read()

    await Bun.sleep(150)
    expect(fired).toBe(true)

    reader.cancel()
    await readPromise.catch(() => {})
  })

  it('resets the timer on each chunk and does NOT call onIdle when stream closes normally', async () => {
    const enc = new TextEncoder()
    let fired = false

    // Stream that emits two chunks 30ms apart then closes — deadline is 100ms
    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode('a'))
        await Bun.sleep(30)
        controller.enqueue(enc.encode('b'))
        controller.close()
      },
    })

    const wrapped = wrapWithIdleTimeout(source, 100, () => {
      fired = true
    })

    const reader = wrapped.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // Wait past the deadline; timer should have been cleared in flush()
    await Bun.sleep(150)
    expect(fired).toBe(false)
  })
})

// ── runStreaming integration test ──────────────────────────────────────────────

describe('runStreaming — idleTimeoutMs', () => {
  it('kills a hanging subprocess and returns exitCode 124', async () => {
    const fixture = join(import.meta.dir, 'fixtures/hang.ts')
    const result = await runStreaming(
      { command: 'bun', args: [fixture] },
      {
        idleTimeoutMs: 150,
        onStdout: async (stream) => {
          for await (const _chunk of stream) {
            // drain
          }
        },
      },
    )
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(124)
  }, 5_000)

  it('marks idle timed out separately from timed out', async () => {
    const fixture = join(import.meta.dir, 'fixtures/hang.ts')
    const result = await runStreaming(
      { command: 'bun', args: [fixture] },
      {
        idleTimeoutMs: 150,
        onStdout: async (stream) => {
          for await (const _chunk of stream) {
            // drain
          }
        },
      },
    )
    expect(result.idleTimedOut).toBe(true)
    expect(result.timedOut).toBe(true)
  }, 5_000)
})
