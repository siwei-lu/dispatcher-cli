#!/usr/bin/env node
const { execSync } = require('child_process')
const fs = require('fs')

let input
try {
  input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
} catch {
  process.exit(0)
}
const filePath = input?.tool_input?.file_path || input?.tool_input?.path || ''

if (!filePath || !fs.existsSync(filePath)) process.exit(0)

// Only format file types prettier knows about.
const SUPPORTED = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|css|scss|html)$/i
if (!SUPPORTED.test(filePath)) process.exit(0)

const FORMAT_COMMAND = 'bunx prettier --write'

try {
  execSync(`${FORMAT_COMMAND} ${JSON.stringify(filePath)}`, { stdio: 'ignore' })
} catch {
  // Formatter failure is non-blocking
}

process.exit(0)
