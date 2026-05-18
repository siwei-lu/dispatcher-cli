import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runUpdate } from '../src/commands/update.ts'

const makeRelease = (tag: string) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: 'dispatch-darwin-arm64',
      browser_download_url: 'https://example.com/dispatch-darwin-arm64',
    },
  ],
})

describe('runUpdate', () => {
  let originalFetch: typeof globalThis.fetch
  let originalStdoutWrite: typeof process.stdout.write
  let originalStderrWrite: typeof process.stderr.write
  let stdout: string[]
  let stderr: string[]
  let tempDirs: string[]

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalStdoutWrite = process.stdout.write
    originalStderrWrite = process.stderr.write
    stdout = []
    stderr = []
    tempDirs = []

    process.stdout.write = captureWrite(stdout)
    process.stderr.write = captureWrite(stderr) as typeof process.stderr.write
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite

    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
  })

  it('--check with latest equal to local prints already on latest and exits 0', async () => {
    const { binaryPath } = makeBinary()
    stubFetch(() => new Response(JSON.stringify(makeRelease('v0.6.2'))))

    const code = await runUpdate({
      check: true,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain(
      'dispatch update: already on latest (v0.6.2)',
    )
  })

  it('--check with newer latest prints availability, exits 1, and leaves binary unchanged', async () => {
    const { binaryPath } = makeBinary()
    stubFetch(() => new Response(JSON.stringify(makeRelease('v0.7.0'))))

    const code = await runUpdate({
      check: true,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(1)
    expect(stdout.join('')).toContain(
      "dispatch update: v0.7.0 available (currently v0.6.2). Run 'dispatch update' to install.",
    )
    expect(readFileSync(binaryPath, 'utf8')).toBe('old binary')
  })

  it('installs a newer latest release by replacing the binary', async () => {
    const { binaryPath } = makeBinary()
    const fetchMock = stubFetch((url) => {
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify(makeRelease('v0.7.0')))
      }
      if (url === 'https://example.com/dispatch-darwin-arm64') {
        return new Response('new binary')
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const code = await runUpdate({
      check: false,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(0)
    expect(fetchMock.mock.calls.length).toBe(2)
    expect(readFileSync(binaryPath, 'utf8')).toBe('new binary')
    expect(stdout.join('')).toContain(
      'dispatch update: upgraded v0.6.2 → v0.7.0',
    )
  })

  it('--version for a missing tag returns 1 and leaves no temp file', async () => {
    const { dir, binaryPath } = makeBinary()
    stubFetch(
      () =>
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
        }),
    )

    const code = await runUpdate({
      check: false,
      version: 'v0.0.0-does-not-exist',
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain(
      'dispatch: update: release not found: v0.0.0-does-not-exist',
    )
    expect(readdirSync(dir).sort()).toEqual(['dispatch'])
  })

  it('--check and --version together exits 2', async () => {
    const { binaryPath } = makeBinary()
    const fetchMock = stubFetch(() => {
      throw new Error('unexpected fetch')
    })

    const code = await runUpdate({
      check: true,
      version: 'v0.6.0',
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(2)
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  it('dev mode refuses to replace a bun runtime path', async () => {
    const { binaryPath } = makeBinary('bun')
    const fetchMock = stubFetch(() => {
      throw new Error('unexpected fetch')
    })

    const code = await runUpdate({
      check: false,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(1)
    expect(fetchMock.mock.calls.length).toBe(0)
    expect(stderr.join('')).toContain(
      'dispatch: update: refusing to self-update',
    )
  })

  it('unsupported platforms return a no-prebuilt error', async () => {
    const { binaryPath } = makeBinary()
    const fetchMock = stubFetch(() => {
      throw new Error('unexpected fetch')
    })

    const code = await runUpdate({
      check: false,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'freebsd',
      _arch: 'x64',
    })

    expect(code).toBe(1)
    expect(fetchMock.mock.calls.length).toBe(0)
    expect(stderr.join('')).toContain(
      'dispatch: update: no prebuilt binary for freebsd/x64',
    )
  })

  it('GitHub API rate limiting exits 1 and leaves no partial download', async () => {
    const { dir, binaryPath } = makeBinary()
    const reset = '2000000000'
    stubFetch(
      () =>
        new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 403,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': reset,
          },
        }),
    )

    const code = await runUpdate({
      check: false,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(1)
    expect(stdout.join('')).toContain(
      'dispatch: update: GitHub API rate limit exceeded. ' +
        `Try again after ${new Date(Number(reset) * 1000).toUTCString()}.`,
    )
    expect(readFileSync(binaryPath, 'utf8')).toBe('old binary')
    expect(readdirSync(dir).sort()).toEqual(['dispatch'])
  })

  function captureWrite(output: string[]): typeof process.stdout.write {
    return ((chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk),
      )
      return true
    }) as typeof process.stdout.write
  }

  function makeBinary(name = 'dispatch'): { dir: string; binaryPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'dispatch-update-test-'))
    tempDirs.push(dir)
    const binaryPath = join(dir, name)
    writeFileSync(binaryPath, 'old binary')
    return { dir, binaryPath }
  }

  function stubFetch(
    handler: (url: string) => Response | Promise<Response>,
  ): ReturnType<typeof mock> {
    const fetchMock = mock(async (url: string | URL | Request) =>
      handler(String(url)),
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    return fetchMock
  }
})
