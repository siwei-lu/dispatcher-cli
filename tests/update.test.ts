import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { access, copyFile, rename, rm, unlink } from 'node:fs/promises'
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
    stubFetch(() => new Response(JSON.stringify(makeRelease('v1.0.0'))))

    const code = await runUpdate({
      check: true,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _localVersion: '1.0.0',
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain(
      'dispatch update: already on latest (v1.0.0)',
    )
  })

  it('--check with newer latest prints availability, exits 1, and leaves binary unchanged', async () => {
    const { binaryPath } = makeBinary()
    stubFetch(() => new Response(JSON.stringify(makeRelease('v1.1.0'))))

    const code = await runUpdate({
      check: true,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _localVersion: '1.0.0',
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(1)
    expect(stdout.join('')).toContain(
      "dispatch update: v1.1.0 available (currently v1.0.0). Run 'dispatch update' to install.",
    )
    expect(readFileSync(binaryPath, 'utf8')).toBe('old binary')
  })

  it('installs a newer latest release by replacing the binary', async () => {
    const { binaryPath } = makeBinary()
    const fetchMock = stubFetch((url) => {
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify(makeRelease('v1.1.0')))
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
      _localVersion: '1.0.0',
      _platform: 'darwin',
      _arch: 'arm64',
    })

    expect(code).toBe(0)
    expect(fetchMock.mock.calls.length).toBe(2)
    expect(readFileSync(binaryPath, 'utf8')).toBe('new binary')
    expect(stdout.join('')).toContain(
      'dispatch update: upgraded v1.0.0 → v1.1.0',
    )
  })

  it('writes the downloaded binary to os.tmpdir before replacing the binary', async () => {
    const { dir, binaryPath } = makeBinary()
    const tempRoot = mkdtempSync(join(tmpdir(), 'dispatch-update-temp-'))
    tempDirs.push(tempRoot)
    const writtenPaths: string[] = []
    const renamedPaths: string[] = []
    stubUpdateFetch()

    const code = await runUpdate({
      check: false,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _localVersion: '1.0.0',
      _platform: 'darwin',
      _arch: 'arm64',
      _installDeps: {
        tmpdir: () => tempRoot,
        write: ((filePath, data) => {
          writtenPaths.push(String(filePath))
          const writeFile = Bun.write as (
            destination: string,
            input: unknown,
          ) => Promise<number>
          return writeFile(String(filePath), data)
        }) as typeof Bun.write,
        rename: (async (from, to) => {
          renamedPaths.push(String(from))
          return rename(from, to)
        }) as typeof rename,
      },
    })

    expect(code).toBe(0)
    expect(readFileSync(binaryPath, 'utf8')).toBe('new binary')
    expect(writtenPaths).toHaveLength(1)
    expect(writtenPaths[0]?.startsWith(tempRoot)).toBe(true)
    expect(writtenPaths[0]?.startsWith(dir)).toBe(false)
    expect(renamedPaths).toEqual(writtenPaths)
    expect(readdirSync(dir).sort()).toEqual(['dispatch'])
  })

  it('copies and unlinks the temp file when rename crosses devices', async () => {
    const { binaryPath } = makeBinary()
    const tempRoot = mkdtempSync(join(tmpdir(), 'dispatch-update-temp-'))
    tempDirs.push(tempRoot)
    const copiedPaths: string[] = []
    const unlinkedPaths: string[] = []
    stubUpdateFetch()

    const code = await runUpdate({
      check: false,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _localVersion: '1.0.0',
      _platform: 'darwin',
      _arch: 'arm64',
      _installDeps: {
        tmpdir: () => tempRoot,
        rename: (async () => {
          const err = new Error('cross-device link') as NodeJS.ErrnoException
          err.code = 'EXDEV'
          throw err
        }) as typeof rename,
        copyFile: (async (from, to) => {
          copiedPaths.push(String(from))
          return copyFile(from, to)
        }) as typeof copyFile,
        unlink: (async (filePath) => {
          unlinkedPaths.push(String(filePath))
          return unlink(filePath)
        }) as typeof unlink,
      },
    })

    expect(code).toBe(0)
    expect(readFileSync(binaryPath, 'utf8')).toBe('new binary')
    expect(copiedPaths).toHaveLength(1)
    expect(copiedPaths[0]?.startsWith(tempRoot)).toBe(true)
    expect(unlinkedPaths).toEqual(copiedPaths)
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('checks binary directory writability before downloading the asset', async () => {
    const { dir, binaryPath } = makeBinary()
    const fetchMock = stubFetch((url) => {
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify(makeRelease('v1.1.0')))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const code = await runUpdate({
      check: false,
      prerelease: false,
      _realBinaryPath: binaryPath,
      _localVersion: '1.0.0',
      _platform: 'darwin',
      _arch: 'arm64',
      _installDeps: {
        access: (async () => {
          const err = new Error('permission denied') as NodeJS.ErrnoException
          err.code = 'EACCES'
          throw err
        }) as typeof access,
      },
    })

    expect(code).toBe(1)
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(readFileSync(binaryPath, 'utf8')).toBe('old binary')
    expect(stderr.join('')).toContain(
      `dispatch: update: cannot write to ${dir}: permission denied.`,
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
    expect(stderr.join('')).toContain(
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

  function stubUpdateFetch(): ReturnType<typeof mock> {
    return stubFetch((url) => {
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify(makeRelease('v1.1.0')))
      }
      if (url === 'https://example.com/dispatch-darwin-arm64') {
        return new Response('new binary')
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }
})
