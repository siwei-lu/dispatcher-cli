# dispatcher-cli

A tiny [Bun](https://bun.sh) CLI that wraps multiple non-interactive AI coding
agents behind one command. Today it speaks `claude -p` and `codex exec`; the
adapter layer makes adding more straightforward.

```bash
dispatch exec -a claude "explain this repo"
echo "summarize README" | dispatch exec -a codex
dispatch exec -a claude -- --verbose --debug "drill in"
dispatch list
```

## Why

If you orchestrate AI coding agents from scripts, CI, or other agents, you
quickly grow tired of remembering vendor-specific flags. `dispatcher-cli` gives
you one stable surface — `dispatch exec` — and routes calls to whichever
backend is selected.

## Install

```bash
bun install
bun link        # exposes the `dispatch` bin globally
# or
bun run src/index.ts exec -a claude "hi"
```

Build a standalone binary:

```bash
bun run build:bin   # → dist/dispatch
```

## Usage

```
Usage: dispatch <command> [options]

Commands:
  exec [...prompt]                      Run a non-interactive prompt against an AI coding agent
  list                                  Show available agent backends and their status
  hook <name>                           Run a dispatch hook handler (for use in Claude Code settings)
  install [--scope global|project]      Register the PreToolUse Bash hook in Claude Code settings
  uninstall [--scope global|project]    Remove the hook from Claude Code settings

Common exec options:
  -a, --agent <name>    Agent backend (claude|codex)
  -m, --model <model>   Model identifier passed to the backend
  -C, --cwd <dir>       Working directory for the spawned process
      --timeout <ms>    Abort backend if it exceeds this duration
  --                    Forward everything after this verbatim to the backend
```

The only supported hook name is `bash-pre`: it reads a Claude Code `PreToolUse` JSON payload from
stdin and emits an allow (`{}`) or block decision. `install` and `uninstall` default to `--scope
global`; pass `--scope project` to target `.claude/settings.json` in the current git repo.

### Prompt input

The prompt can be passed positionally **or** piped via stdin:

```bash
dispatch exec -a claude "what does package.json look like"
cat README.md | dispatch exec -a codex
```

### Environment defaults

| Variable         | Effect                               |
| ---------------- | ------------------------------------ |
| `DISPATCH_AGENT` | Default agent when `-a` is omitted.  |
| `DISPATCH_MODEL` | Default model passed to the backend. |

CLI flags always win over env vars.

## Output

Both backends run in structured streaming mode. Events are printed as a
bracketed stream to stdout as they arrive:

```
[start] claude · claude-opus-4-7
[task] explain this repo
[tool] Bash: find . -name "*.ts" | head -20
[done] This repo is a Bun-based CLI that...
cost=$0.0031 · 22k tokens · 4.2s
```

## Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| 0    | Backend exited cleanly                                                                      |
| 1    | Unknown top-level command, or dispatcher-cli internal error                                 |
| 2    | Bad arguments to a known subcommand (missing prompt, unknown agent, invalid --output, etc.) |
| 124  | Backend was killed by `--timeout`                                                           |
| 127  | Backend binary not found on PATH                                                            |
| \*   | Otherwise mirrors the underlying backend's exit code                                        |

## Adapters

Each adapter implements:

```ts
interface Adapter {
  name: string
  binary: string
  build(opts: DispatchOptions): BuiltCommand
  supports(option: 'model' | 'cwd'): boolean
  parseEvent(event: unknown): DispatcherEvent | null
}
```

The two built-in adapters live in `src/adapters/`. Adding a new agent is just a
new file plus a row in `src/adapters/registry.ts`.

## Develop

```bash
bun install
bun test
bun run typecheck
bun run dev exec -a claude "hi"
```
