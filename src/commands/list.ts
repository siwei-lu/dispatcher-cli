import { adapters } from '../adapters/registry.ts'

interface Row {
  name: string
  path: string
  version: string
  status: string
}

export async function runList(): Promise<number> {
  const rows: Row[] = []

  for (const [name, adapter] of Object.entries(adapters)) {
    const resolved = Bun.which(adapter.binary)
    if (!resolved) {
      rows.push({ name, path: '-', version: '-', status: 'missing' })
      continue
    }
    const version = await probeVersion(resolved)
    rows.push({ name, path: resolved, version, status: 'ready' })
  }

  printTable(rows)
  return 0
}

async function probeVersion(binary: string): Promise<string> {
  try {
    const proc = Bun.spawn([binary, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) return 'unknown'
    const text = await new Response(proc.stdout).text()
    const firstLine = text.split('\n')[0]?.trim() ?? ''
    return firstLine || 'unknown'
  } catch {
    return 'unknown'
  }
}

function printTable(rows: Row[]) {
  const headers: Row = {
    name: 'AGENT',
    path: 'PATH',
    version: 'VERSION',
    status: 'STATUS',
  }
  const all = [headers, ...rows]
  const widths = {
    name: max(all.map((r) => r.name.length)),
    path: max(all.map((r) => r.path.length)),
    version: max(all.map((r) => r.version.length)),
    status: max(all.map((r) => r.status.length)),
  }

  for (const row of all) {
    const line = [
      row.name.padEnd(widths.name),
      row.path.padEnd(widths.path),
      row.version.padEnd(widths.version),
      row.status.padEnd(widths.status),
    ].join('  ')
    process.stdout.write(line + '\n')
  }
}

function max(nums: number[]): number {
  let m = 0
  for (const n of nums) if (n > m) m = n
  return m
}
