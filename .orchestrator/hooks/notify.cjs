#!/usr/bin/env node
const { execSync } = require('child_process')
let input
try {
  input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'))
} catch {
  process.exit(0)
}
const message = (input?.message || 'Orchestrator needs attention').replace(
  /['"\\]/g,
  '',
)

// macOS desktop notification
try {
  execSync(
    `osascript -e ${JSON.stringify(`display notification "${message}" with title "Orchestrator"`)}`,
    { stdio: 'ignore' },
  )
} catch {
  /* not macOS */
}

// Linux desktop notification
try {
  execSync(`notify-send "Orchestrator" ${JSON.stringify(message)}`, {
    stdio: 'ignore',
  })
} catch {
  /* not Linux or notify-send not installed */
}

// Slack webhook (set SLACK_WEBHOOK_URL env var to enable)
const webhookUrl = process.env.SLACK_WEBHOOK_URL
if (webhookUrl) {
  try {
    execSync(
      `curl -s -X POST "${webhookUrl}" -H 'Content-Type: application/json' \
      -d '{"text":"🤖 Orchestrator: ${message}"}'`,
      { stdio: 'ignore' },
    )
  } catch {
    /* webhook failed */
  }
}

process.exit(0)
