# PRD: dispatcher-cli

## Overview

`dispatcher-cli` is a Bun-based command-line tool that exposes a single,
non-interactive entry point — `dispatch exec` — for running multiple AI coding
agents (Anthropic's `claude -p` and OpenAI Codex's `codex exec`). Engineers and
CI pipelines can issue one consistent command instead of remembering each
vendor's flag set, which makes it easy to swap backends inside scripts,
orchestrators, and headless workflows.

## Tech Decisions

- **Frontend:** N/A (terminal CLI)
- **Backend:** TypeScript on Bun ≥ 1.3
- **Database:** N/A
- **Deployment:** Published as a Bun/Node-compatible npm package; ships a
  `dispatch` bin script. Optional standalone binary via `bun build --compile`.
- **Monorepo:** No — single package.
- **CLI parsing:** `cac` (tiny, zero-runtime-overhead, plays well with Bun).
- **Subprocess:** `Bun.spawn` with stdio pass-through.

## Functional Modules

### FM-001: CLI Entry & Argument Parsing

**Priority:** P0
**Dependencies:** none
**Description:** Set up the `dispatch` binary, top-level help, version, and the
subcommand router built with `cac`.
**Constraints:**

- Binary name is `dispatch`; the npm package is `dispatcher-cli`.
- Must run under Bun ≥ 1.3.
- Top-level usage: `dispatch <command> [options] [args]`.
- Unknown subcommands exit non-zero with a usage hint.

**Acceptance Criteria:**

- `dispatch --help` lists `exec` and `list` subcommands.
- `dispatch --version` prints the package version.
- `dispatch bogus` exits with code 1 and a "Unknown command" message.

### FM-002: `dispatch exec` Subcommand

**Priority:** P0
**Dependencies:** FM-001, FM-003, FM-004
**Description:** The core command. Accepts a prompt (positional or stdin),
selects a backend, and dispatches the call.
**Constraints:**

- Usage: `dispatch exec [options] [prompt]`.
- Options:
  - `-a, --agent <name>` — `claude` | `codex` (case-insensitive).
  - `-m, --model <model>` — pass-through model override.
  - `-C, --cwd <dir>` — working directory for the subprocess.
  - `--timeout <ms>` — kill the subprocess if it exceeds this duration.
  - `-o, --output <format>` — `text` | `json` | `stream-json`. Only forwarded
    when the backend supports it (claude does; codex ignores with a warning).
- Prompt resolution order: positional arg → stdin → error.
- Anything after `--` is forwarded verbatim to the backend binary.
- Exit code mirrors the backend's exit code (or 124 on timeout).

**Acceptance Criteria:**

- `dispatch exec -a claude "say hi"` invokes `claude -p "say hi"`.
- `echo "say hi" | dispatch exec -a codex` invokes `codex exec` with the
  piped text as the prompt.
- `dispatch exec -a claude -- --verbose "say hi"` forwards `--verbose` to
  claude.
- Timeout: `dispatch exec -a claude --timeout 50 "loop forever"` exits 124.

### FM-003: Claude Adapter

**Priority:** P0
**Dependencies:** FM-001
**Description:** Translates the unified flags into a `claude -p` invocation.
**Constraints:**

- Always passes `-p` for non-interactive mode.
- Maps `--model` → `--model`.
- Maps `--output` → `--output-format`.
- Maps `--cwd` → `Bun.spawn`'s `cwd` option.
- Streams stdout/stderr directly (no buffering).
- If the `claude` binary is missing from PATH, exits 127 with a clear message.

**Acceptance Criteria:**

- Adapter object exposes `{ name: "claude", build(opts), supports(option) }`.
- `claude --version` is invoked by the `list` command and printed.

### FM-004: Codex Adapter

**Priority:** P0
**Dependencies:** FM-001
**Description:** Translates the unified flags into a `codex exec` invocation.
**Constraints:**

- Always passes the `exec` subcommand.
- Maps `--model` → `-m`.
- Maps `--cwd` → `-C` (and falls back to `Bun.spawn` `cwd`).
- Adds `--skip-git-repo-check` by default to keep the call usable in arbitrary
  directories; can be suppressed with passthrough args.
- `--output` is not supported by `codex exec`; if the user supplied it, emit a
  warning on stderr and continue.

**Acceptance Criteria:**

- Adapter exposes the same shape as the claude adapter.
- Missing `codex` binary → exit 127 with helpful message.

### FM-005: Defaults & Environment

**Priority:** P1
**Dependencies:** FM-002
**Description:** Resolve the active agent/model from a precedence chain.
**Constraints:**

- Precedence (highest → lowest): CLI flag > env var > built-in default.
- `DISPATCH_AGENT` — default agent (`claude` if unset and claude is on PATH;
  otherwise `codex`).
- `DISPATCH_MODEL` — default model.
- No config file in MVP (keep surface minimal); add later if needed.

**Acceptance Criteria:**

- With `DISPATCH_AGENT=codex` and no `-a` flag, `dispatch exec "..."` routes
  to codex.
- `-a claude` overrides `DISPATCH_AGENT=codex`.

### FM-006: `dispatch list`

**Priority:** P1
**Dependencies:** FM-003, FM-004
**Description:** Show which backends are installed, their PATH location, and
their reported version.
**Constraints:**

- Each row: `name | path | version | status`.
- Status: `ready` | `missing`.

**Acceptance Criteria:**

- `dispatch list` prints a table with one row per known adapter.

### FM-007: Passthrough Args

**Priority:** P1
**Dependencies:** FM-002
**Description:** Everything after `--` is forwarded to the backend binary as
raw argv.
**Constraints:**

- The passthrough args are inserted after the adapter's structured args but
  before the prompt positional, so vendor flags work as expected.

**Acceptance Criteria:**

- `dispatch exec -a claude -- --verbose --debug "prompt"` results in
  `claude -p --verbose --debug "prompt"` being spawned.

## Non-Functional Requirements

- Cold-start (Bun): under 100 ms for `dispatch --help`.
- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`).
- Tests run with `bun test`.
- Linting: stay zero-config (use Bun + tsc only); no ESLint in MVP.
- macOS and Linux supported; Windows untested but should work via Bun.

## Out of Scope

- Interactive REPL or chat-mode wrapper.
- Direct HTTP calls to the Anthropic or OpenAI APIs (we wrap existing CLIs).
- Conversation/session persistence and `--resume` semantics.
- Custom agent implementations beyond the two listed adapters.
- Config files (env vars + flags only for MVP).
- Plugin system.

## Changelog

### Round 1 — 2026-05-17

- Initial version inferred from one-line brief (Bun, `dispatch exec` over
  `claude -p` and `codex exec`).
