#!/usr/bin/env node
const fs = require('fs')
let input
try {
  input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
} catch {
  process.exit(0)
}
const cmd = input?.tool_input?.command || ''

// Only intercept git commit commands
if (!/^git\s+commit/.test(cmd)) process.exit(0)

// Extract commit message from -m flag (single or double quoted)
const match = cmd.match(/-m\s*["'](.+?)["']/)
if (!match) process.exit(0)

const msg = match[1]
const configPath = '.orchestrator/project.config.json'

try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const regex = config.commit_regex
  if (!regex) process.exit(0)

  if (new RegExp(regex).test(msg)) {
    process.exit(0)
  } else {
    const desc = config.commit_pattern_description || 'the project convention'
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          `Commit message doesn't match ${desc}. Expected pattern: ${regex}\n` +
          `Examples:\n  ${(config.commit_examples || []).map((e) => `- ${e}`).join('\n  ')}`,
      }),
    )
    process.exit(2)
  }
} catch {
  process.exit(0)
}
