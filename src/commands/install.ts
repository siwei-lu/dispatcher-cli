import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

interface HookEntry {
  type: string
  command: string
  [key: string]: unknown
}
interface HookMatcher {
  matcher: string
  hooks: HookEntry[]
  [key: string]: unknown
}
interface SettingsJson {
  hooks?: { PreToolUse?: HookMatcher[]; [key: string]: unknown }
  [key: string]: unknown
}

type SettingsSubcommand = 'install' | 'uninstall'
type SettingsReadResult =
  | { ok: true; settings: SettingsJson | null }
  | { ok: false }

const OUR_COMMAND = 'dispatch hook bash-pre'
const OUR_ENTRY: HookEntry = { type: 'command', command: OUR_COMMAND }

function resolveSettingsPath(scope: 'global' | 'project'): string {
  if (scope === 'global') {
    return join(process.env['HOME'] ?? homedir(), '.claude', 'settings.json')
  }
  return join(process.cwd(), '.claude', 'settings.json')
}

function isInsideGitRepo(cwd: string): boolean {
  const result = Bun.spawnSync(['git', 'rev-parse', '--is-inside-work-tree'], {
    cwd,
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return result.exitCode === 0
}

function readSettings(filePath: string): SettingsReadResult {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return { ok: true, settings: null }
  }

  try {
    return { ok: true, settings: JSON.parse(raw) as SettingsJson }
  } catch {
    return { ok: false }
  }
}

function invalidSettingsMessage(
  subcmd: SettingsSubcommand,
  settingsPath: string,
): string {
  return `dispatch: ${subcmd}: ${settingsPath} contains invalid JSON — fix it manually\n`
}

function validateSettingsShape(
  settings: SettingsJson,
  subcmd: SettingsSubcommand,
  settingsPath: string,
): string | null {
  const message = invalidSettingsMessage(subcmd, settingsPath)

  if (
    typeof settings !== 'object' ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return message
  }

  if (
    'hooks' in settings &&
    (typeof settings.hooks !== 'object' ||
      settings.hooks === null ||
      Array.isArray(settings.hooks))
  ) {
    return message
  }

  if (
    settings.hooks &&
    'PreToolUse' in settings.hooks &&
    !Array.isArray(settings.hooks.PreToolUse)
  ) {
    return message
  }

  return null
}

async function writeSettings(
  filePath: string,
  settings: SettingsJson,
): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const serialized = JSON.stringify(settings, null, 2) + '\n'
  const tempPath = filePath + '.tmp.' + Date.now()
  await Bun.write(tempPath, serialized)
  await rename(tempPath, filePath)
}

async function deleteFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch {
    /* already gone */
  }
}

export async function runInstall(scope: 'global' | 'project'): Promise<number> {
  const settingsPath = resolveSettingsPath(scope)

  if (scope === 'project' && !isInsideGitRepo(process.cwd())) {
    process.stderr.write(
      'dispatch: install: --scope project requires a git repository\n',
    )
    return 2
  }

  const readResult = readSettings(settingsPath)
  if (!readResult.ok) {
    process.stderr.write(invalidSettingsMessage('install', settingsPath))
    return 1
  }
  const settings = readResult.settings ?? {}

  const shapeError = validateSettingsShape(settings, 'install', settingsPath)
  if (shapeError) {
    process.stderr.write(shapeError)
    return 1
  }

  settings.hooks ??= {}
  settings.hooks.PreToolUse ??= []
  const preToolUse = settings.hooks.PreToolUse

  const existingBashBlock = preToolUse.find(
    (b) =>
      b.matcher === 'Bash' &&
      Array.isArray(b.hooks) &&
      b.hooks.some((h) => h.command === OUR_COMMAND),
  )
  if (existingBashBlock) {
    process.stdout.write(
      `dispatch: install: already configured at ${resolve(settingsPath)}\n`,
    )
    return 0
  }

  const bashBlock = preToolUse.find(
    (b) => b.matcher === 'Bash' && Array.isArray(b.hooks),
  )
  if (bashBlock) {
    bashBlock.hooks.push({ ...OUR_ENTRY })
  } else {
    preToolUse.push({ matcher: 'Bash', hooks: [{ ...OUR_ENTRY }] })
  }

  await writeSettings(settingsPath, settings)
  process.stdout.write(
    `dispatch: install: configured at ${resolve(settingsPath)}\n`,
  )
  return 0
}

export async function runUninstall(
  scope: 'global' | 'project',
): Promise<number> {
  const settingsPath = resolveSettingsPath(scope)

  if (scope === 'project' && !isInsideGitRepo(process.cwd())) {
    process.stderr.write(
      'dispatch: uninstall: --scope project requires a git repository\n',
    )
    return 2
  }

  const readResult = readSettings(settingsPath)
  if (!readResult.ok) {
    process.stderr.write(invalidSettingsMessage('uninstall', settingsPath))
    return 1
  }
  const settings = readResult.settings

  if (!settings) {
    process.stdout.write(
      `dispatch: uninstall: not configured at ${resolve(settingsPath)}\n`,
    )
    return 0
  }

  const shapeError = validateSettingsShape(settings, 'uninstall', settingsPath)
  if (shapeError) {
    process.stderr.write(shapeError)
    return 1
  }

  const preToolUse = settings.hooks?.PreToolUse
  if (!preToolUse) {
    process.stdout.write(
      `dispatch: uninstall: not configured at ${resolve(settingsPath)}\n`,
    )
    return 0
  }

  let removedAny = false
  for (const block of preToolUse) {
    if (!Array.isArray(block.hooks)) continue // skip malformed block; leave it untouched
    const before = block.hooks.length
    block.hooks = block.hooks.filter((h) => h.command !== OUR_COMMAND)
    if (block.hooks.length < before) removedAny = true
  }

  if (!removedAny) {
    process.stdout.write(
      `dispatch: uninstall: not configured at ${resolve(settingsPath)}\n`,
    )
    return 0
  }

  settings.hooks!.PreToolUse = preToolUse.filter(
    (b) => !Array.isArray(b.hooks) || b.hooks.length > 0,
  )
  if (settings.hooks!.PreToolUse.length === 0) {
    delete settings.hooks!.PreToolUse
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }

  if (Object.keys(settings).length === 0) {
    await deleteFile(settingsPath)
    process.stdout.write(
      `dispatch: uninstall: removed from ${resolve(settingsPath)}\n`,
    )
    return 0
  }

  await writeSettings(settingsPath, settings)
  process.stdout.write(
    `dispatch: uninstall: removed from ${resolve(settingsPath)}\n`,
  )
  return 0
}
