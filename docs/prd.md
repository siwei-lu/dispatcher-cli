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
- **Subprocess:** `Bun.spawn` — stdout piped (parsed line-by-line as JSONL),
  stderr inherited, stdin inherited.

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
**Dependencies:** FM-001, FM-003, FM-004, FM-008
**Description:** The core command. Accepts a prompt (positional or stdin),
selects a backend, invokes it with structured streaming enabled (claude:
`--output-format stream-json --verbose`; codex: `--json`), and renders the
filtered event view defined by FM-008.
**Constraints:**

- Usage: `dispatch exec [options] [prompt]`.
- Options:
  - `-a, --agent <name>` — `claude` | `codex` (case-insensitive).
  - `-m, --model <model>` — pass-through model override.
  - `-C, --cwd <dir>` — working directory for the subprocess.
  - `--timeout <ms>` — kill the subprocess if it exceeds this duration.
- There is **no** `-o/--output` flag. Backend output is always the structured
  event stream; the user-facing rendering is fixed (see FM-008).
- Prompt resolution order: positional arg → stdin → error (exit 2).
- Anything after `--` is forwarded verbatim to the backend binary, inserted
  between the structured-output flags and the prompt positional.
- Exit code mirrors the backend's exit code (or 124 on timeout). A `result`
  event with `is_error: true` on the claude side does **not** change the
  exit code — the backend's own exit code is the source of truth.

**Acceptance Criteria:**

- `dispatch exec -a claude "say hi"` spawns
  `claude -p --output-format stream-json --verbose "say hi"`.
- `echo "say hi" | dispatch exec -a codex` spawns
  `codex exec --json --skip-git-repo-check "say hi"` (stdin consumed before
  spawn).
- `dispatch exec -a claude -- --debug "say hi"` spawns
  `claude -p --output-format stream-json --verbose --debug "say hi"`.
- Timeout: `dispatch exec -a claude --timeout 50 "loop forever"` exits 124.

### FM-003: Claude Adapter

**Priority:** P0
**Dependencies:** FM-001, FM-008
**Description:** Translates the unified flags into a `claude -p` invocation
and normalizes claude's stream-json events into the dispatcher event shape.
**Constraints:**

- Always passes `-p` for non-interactive mode.
- Always passes `--output-format stream-json --verbose` (verbose is required
  for stream-json to emit per-message events rather than a single result).
- Does NOT pass `--include-hook-events` or `--include-partial-messages`
  (those add noise we'd otherwise have to filter).
- Maps `--model` → `--model`.
- Maps `--cwd` → `Bun.spawn`'s `cwd` option.
- Stdout is piped (consumed by the event parser); stderr is inherited so
  backend errors surface unchanged.
- If the `claude` binary is missing from PATH, exits 127 with a clear message.
- Implements `parseEvent(line)`: maps `system.init` → `start`,
  `assistant` content blocks → `thinking` / `tool` events,
  `result` → `done`. Filters `system.hook_*`, `rate_limit_event`, and any
  partial-message types.

**Acceptance Criteria:**

- Adapter object exposes
  `{ name: "claude", binary, build(opts), supports(option), parseEvent(line) }`.
- `supports('model')` and `supports('cwd')` return true; `supports('output')`
  is gone from the option union (compile-time guarantee).
- `claude --version` is invoked by the `list` command and printed.
- Given a `system.init` line, `parseEvent` returns a `start` event with the
  model field populated.
- Given a `result` line with `total_cost_usd`, `parseEvent` returns a `done`
  event carrying result, cost, duration, and token totals.

### FM-004: Codex Adapter

**Priority:** P0
**Dependencies:** FM-001, FM-008
**Description:** Translates the unified flags into a `codex exec` invocation
and normalizes codex's `--json` event stream into the dispatcher event shape.
**Constraints:**

- Always passes the `exec` subcommand.
- Always passes `--json` (codex's streaming JSONL mode — documented as
  "Print events to stdout as JSONL").
- Maps `--model` → `-m`.
- Maps `--cwd` → `-C` (and also falls back to `Bun.spawn` `cwd`).
- Adds `--skip-git-repo-check` by default to keep the call usable in arbitrary
  directories; can be suppressed with passthrough args.
- Stdout is piped (consumed by the event parser); stderr is inherited.
- Implements `parseEvent(line)`: maps `thread.started` → `start`,
  `item.completed` with `item.type = agent_message` → `done`-shaped event;
  tool / reasoning item types map to `tool` / `thinking` (precise codex event
  taxonomy for tool calls must be verified at implementation time with a
  small tool-using probe — `codex exec --json --skip-git-repo-check "read
package.json"`).
- `turn.completed` carries `usage`; the adapter merges it into the eventual
  `done` event so cost/tokens can be rendered.

**Acceptance Criteria:**

- Adapter object exposes the same shape as the claude adapter
  (`build`, `supports`, `parseEvent`).
- `supports('model')` and `supports('cwd')` return true.
- Missing `codex` binary → exit 127 with helpful message.
- Given a `thread.started` line, `parseEvent` returns a `start` event whose
  agent field is `"codex"`.
- Given a `turn.completed` + a preceding `item.completed` for an
  `agent_message`, the adapter's accumulated state yields a `done` event
  with the agent's final text and the token usage from `turn.completed`.

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

- `dispatch exec -a claude -- --debug "prompt"` results in
  `claude -p --output-format stream-json --verbose --debug "prompt"` being
  spawned (passthrough args land between the structured-output flags and the
  prompt).

### FM-008: Event Stream — Parse & Render

**Priority:** P0
**Dependencies:** FM-003, FM-004
**Description:** Convert the backend's JSONL event stream into a small,
fixed set of dispatcher events and render them as plain bracketed lines to
stdout. The dispatcher exposes only "started, doing what, thinking about
what, tool calls, result" — everything else is dropped.
**Constraints:**

- Lives in `src/lib/events.ts` (parser + renderer). Adapters provide the
  per-backend normalization via `parseEvent(line) → DispatcherEvent | null`;
  this module owns the line-buffering, JSON.parse error handling, and
  rendering.
- The shared event type union (in `src/adapters/types.ts`):
  ```ts
  type DispatcherEvent =
    | { type: 'start'; agent: string; model: string }
    | { type: 'task'; prompt: string }
    | { type: 'thinking'; text: string }
    | { type: 'tool'; name: string; brief: string }
    | { type: 'tool_result'; ok: boolean }
    | {
        type: 'done'
        result: string
        costUsd?: number
        durationMs?: number
        tokens?: number
      }
    | { type: 'error'; message: string }
  ```
- The `task` event is synthesized once by `runExec` (not parsed from
  backend output) immediately after resolving the prompt, before the
  subprocess spawn. All other events come from `parseEvent`.
- Rendering (plain ASCII, no emoji, single-line per event unless wrapped):
  - `[start] <agent> · <model>`
  - `[task] <prompt-truncated-to-120-chars>` (with `…` suffix if truncated)
  - `[thinking] <text-truncated-to-120-chars>`
  - `[tool] <name>: <brief-truncated-to-80-chars>`
  - `[done] <result>` (full result, may span lines) followed by a stats
    line: `cost=$X.XXXX · <N>k tokens · <S>s` (omit stats fields that the
    backend didn't provide).
  - `[error] <message>` (goes to stderr, not stdout).
- Line buffering: read piped stdout in chunks, split on `\n`, hold any
  trailing partial line until the next chunk; flush remaining buffer at
  EOF. Empty lines are skipped.
- Malformed JSON line → log a single warning to stderr
  (`dispatch: skipped malformed stream-json line`) and continue. Do NOT
  abort the run on parse failure.
- Filtering: `parseEvent` returns `null` for any backend event we don't
  want to surface (hook lifecycle, rate-limit events, partial deltas).
  `null` returns are silently dropped — no warning.

**Acceptance Criteria:**

- A unit test feeds the parser a captured claude `--output-format
stream-json --verbose` transcript and asserts the resulting
  `DispatcherEvent[]` matches the expected sequence (start, task,
  zero-or-more thinking/tool, done) with no hook/rate-limit pollution.
- Same shape of test for codex `--json` transcript.
- `dispatch exec -a claude "what is 1+1?"` end-to-end prints (at minimum)
  one `[start]`, one `[task]`, and one `[done]` line, with no raw JSON
  visible to the user.
- Malformed input (deliberately corrupted line in the middle of a valid
  stream) does not abort; a single stderr warning is emitted and the
  remaining valid lines are still parsed and rendered.

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
- User-selectable output format. The dispatcher's surface is fixed
  (see FM-008); scripts that need the raw backend JSONL should call
  `claude` / `codex` directly.
- Streaming the assistant's intermediate text. By design we wait for the
  final `result` / `agent_message` and surface it as a single `[done]`
  event.

## Changelog

### Round 2 — 2026-05-17

- **Breaking.** Removed `-o/--output` flag (FM-002). The dispatcher now
  always invokes claude with `--output-format stream-json --verbose` and
  codex with `--json`, parses the JSONL stream, and renders a fixed,
  filtered view (FM-008).
- New FM-008: event normalization + rendering. Adapters gain a
  `parseEvent(line)` method; a shared `DispatcherEvent` union models the
  five surfaced event kinds (start, task, thinking, tool, tool_result,
  done) plus `error`.
- FM-003 / FM-004 updated: claude/codex adapters always pass their
  structured-streaming flags; subprocess stdout switches from `inherit`
  to `pipe` so the event parser can consume it.
- FM-007 acceptance criterion adjusted to reflect the new structured-
  streaming flags inserted before passthrough args.
- Out of Scope additions: user-selectable output format, intermediate
  text streaming.
- Version bumps `0.1.0 → 0.2.0` (breaking change to the CLI surface).

### Round 1 — 2026-05-17

- Initial version inferred from one-line brief (Bun, `dispatch exec` over
  `claude -p` and `codex exec`).
