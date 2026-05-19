import { realpath, chmod, rename, unlink } from 'node:fs/promises'
import * as path from 'node:path'

import pkg from '../../package.json' with { type: 'json' }

interface UpdateOpts {
  check: boolean
  version?: string
  prerelease: boolean
  _execPath?: string
  _realBinaryPath?: string
  _platform?: string
  _arch?: string
  _localVersion?: string
}

interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: ReleaseAsset[]
}

type JsonResult = { ok: true; json: unknown } | { ok: false }

const GITHUB_HEADERS = {
  'User-Agent': `dispatch-cli/${pkg.version}`,
  Accept: 'application/vnd.github+json',
}

const ASSET_MAP: Record<
  string,
  Record<string, string | undefined> | undefined
> = {
  darwin: { arm64: 'dispatch-darwin-arm64', x64: 'dispatch-darwin-x64' },
  linux: { x64: 'dispatch-linux-x64', arm64: 'dispatch-linux-arm64' },
}

function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('-')[0]!.split('.').map(Number)
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a)
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b)
  const pairs: [number, number][] = [
    [aMaj, bMaj],
    [aMin, bMin],
    [aPat, bPat],
  ]
  for (const [x, y] of pairs) {
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

function normalizeVersion(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

function messageFromError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function readResponseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: unknown
  } | null
  if (typeof body?.message === 'string') return body.message
  return response.statusText || 'unknown error'
}

function readReleaseAsset(value: unknown): ReleaseAsset | null {
  if (typeof value !== 'object' || value === null) return null
  const asset = value as {
    name?: unknown
    browser_download_url?: unknown
  }
  return {
    name: typeof asset.name === 'string' ? asset.name : undefined,
    browser_download_url:
      typeof asset.browser_download_url === 'string'
        ? asset.browser_download_url
        : undefined,
  }
}

function readRelease(value: unknown): Release | null {
  if (typeof value !== 'object' || value === null) return null
  const release = value as {
    tag_name?: unknown
    draft?: unknown
    prerelease?: unknown
    assets?: unknown
  }
  if (typeof release.tag_name !== 'string') return null

  const assets = Array.isArray(release.assets)
    ? release.assets
        .map(readReleaseAsset)
        .filter((asset): asset is ReleaseAsset => asset !== null)
    : []

  return {
    tag_name: release.tag_name,
    draft: release.draft === true,
    prerelease: release.prerelease === true,
    assets,
  }
}

async function fetchGitHubJson(
  url: string,
  notFoundTag?: string,
): Promise<JsonResult> {
  let response: Response
  try {
    response = await fetch(url, { headers: GITHUB_HEADERS })
  } catch (err) {
    process.stderr.write(
      `dispatch: update: network error: ${messageFromError(err)}\n`,
    )
    return { ok: false }
  }

  if (response.status === 404 && notFoundTag) {
    process.stderr.write(
      `dispatch: update: release not found: ${notFoundTag}\n`,
    )
    return { ok: false }
  }

  if (
    response.status === 403 &&
    response.headers.get('X-RateLimit-Remaining') === '0'
  ) {
    const reset = response.headers.get('X-RateLimit-Reset')
    const date = new Date(Number(reset) * 1000).toUTCString()
    process.stdout.write(
      'dispatch: update: GitHub API rate limit exceeded. ' +
        `Try again after ${date}.\n`,
    )
    return { ok: false }
  }

  if (!response.ok) {
    const message = await readResponseMessage(response)
    process.stderr.write(
      `dispatch: update: GitHub API returned ${response.status}: ${message}\n`,
    )
    return { ok: false }
  }

  try {
    return { ok: true, json: await response.json() }
  } catch (err) {
    process.stderr.write(
      `dispatch: update: GitHub API returned invalid JSON: ${messageFromError(
        err,
      )}\n`,
    )
    return { ok: false }
  }
}

async function resolveRelease(opts: UpdateOpts): Promise<Release | null> {
  const baseUrl = 'https://api.github.com/repos/siwei-lu/dispatcher-cli'
  if (opts.version) {
    const tag = encodeURIComponent(opts.version)
    const result = await fetchGitHubJson(
      `${baseUrl}/releases/tags/${tag}`,
      opts.version,
    )
    if (!result.ok) return null
    const release = readRelease(result.json)
    if (release) return release
  } else if (opts.prerelease) {
    const result = await fetchGitHubJson(`${baseUrl}/releases?per_page=10`)
    if (!result.ok) return null
    if (Array.isArray(result.json)) {
      for (const item of result.json) {
        const release = readRelease(item)
        if (release && !release.draft) return release
      }
    }
  } else {
    const result = await fetchGitHubJson(`${baseUrl}/releases/latest`)
    if (!result.ok) return null
    const release = readRelease(result.json)
    if (release) return release
  }

  process.stderr.write('dispatch: update: invalid GitHub release response\n')
  return null
}

async function installBinary(
  downloadUrl: string,
  realPath: string,
): Promise<boolean> {
  const dir = path.dirname(realPath)
  const base = path.basename(realPath)
  const tempPath = path.join(dir, '.' + base + '.update-' + process.pid)

  let tempCreated = false
  let renamed = false
  try {
    const resp = await fetch(downloadUrl, { headers: GITHUB_HEADERS })
    if (!resp.ok) {
      const message = await readResponseMessage(resp)
      process.stderr.write(
        `dispatch: update: download failed: ${resp.status}: ${message}\n`,
      )
      return false
    }
    tempCreated = true
    await Bun.write(tempPath, resp)
    await chmod(tempPath, 0o755)
    await rename(tempPath, realPath)
    renamed = true
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      const failedPath = tempCreated ? tempPath : realPath
      process.stderr.write(
        `dispatch: update: cannot write to ${failedPath}: permission denied. ` +
          "Try 'sudo dispatch update' or re-link the binary into a writable directory.\n",
      )
    } else {
      process.stderr.write(`dispatch: update: ${messageFromError(err)}\n`)
    }
    return false
  } finally {
    if (tempCreated && !renamed) {
      await unlink(tempPath).catch(() => {})
    }
  }
}

export async function runUpdate(opts: UpdateOpts): Promise<number> {
  if (opts.check && opts.version) {
    process.stderr.write(
      'dispatch: update: --check and --version cannot be combined\n',
    )
    return 2
  }

  const platform = opts._platform ?? process.platform
  const arch = opts._arch ?? process.arch
  const assetName = ASSET_MAP[platform]?.[arch]
  if (!assetName) {
    process.stderr.write(
      `dispatch: update: no prebuilt binary for ${platform}/${arch}\n`,
    )
    return 1
  }

  const execPath = opts._execPath ?? process.execPath
  let realPath: string
  try {
    realPath = opts._realBinaryPath ?? (await realpath(execPath))
  } catch (err) {
    process.stderr.write(`dispatch: update: ${messageFromError(err)}\n`)
    return 1
  }

  const baseName = path.basename(realPath)
  if (['bun', 'node', 'tsx'].includes(baseName)) {
    process.stderr.write(
      `dispatch: update: refusing to self-update — running under ${baseName}, ` +
        "no compiled dispatch binary to replace. Build one with 'bun run build:bin'.\n",
    )
    return 1
  }

  const release = await resolveRelease(opts)
  if (!release) return 1

  const localVersion = normalizeVersion(opts._localVersion ?? pkg.version)
  const releaseVersion = normalizeVersion(release.tag_name)

  if (!opts.version) {
    const comparison = compareSemver(localVersion, releaseVersion)
    if (comparison === 0) {
      process.stdout.write(
        `dispatch update: already on latest (${localVersion})\n`,
      )
      return 0
    }
    if (comparison > 0) {
      process.stdout.write(
        `dispatch update: running ${localVersion} ` +
          `(latest release is ${releaseVersion})\n`,
      )
      return 0
    }
    if (opts.check) {
      process.stdout.write(
        `dispatch update: ${releaseVersion} available ` +
          `(currently ${localVersion}). Run 'dispatch update' to install.\n`,
      )
      return 1
    }
  }

  const asset = release.assets.find((candidate) => candidate.name === assetName)
  const downloadUrl = asset?.browser_download_url
  if (!downloadUrl) {
    process.stderr.write(
      `dispatch: update: release ${releaseVersion} has no asset ${assetName}\n`,
    )
    return 1
  }

  const installed = await installBinary(downloadUrl, realPath)
  if (!installed) return 1

  if (opts.version) {
    process.stdout.write(
      `dispatch update: installed ${releaseVersion} (was ${localVersion})\n`,
    )
  } else {
    process.stdout.write(
      `dispatch update: upgraded ${localVersion} → ${releaseVersion}\n`,
    )
  }
  return 0
}
