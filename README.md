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
  exec [...prompt]  Run a non-interactive prompt against an AI coding agent
  list              Show available agent backends and their status

Common exec options:
  -a, --agent <name>    Agent backend (claude|codex)
  -m, --model <model>   Model identifier passed to the backend
  -C, --cwd <dir>       Working directory for the spawned process
  -o, --output <fmt>    Output format: text|json|stream-json (claude only)
      --timeout <ms>    Abort backend if it exceeds this duration
  --                    Forward everything after this verbatim to the backend
```

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

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | Backend exited cleanly                               |
| 1    | dispatcher-cli internal error                        |
| 2    | Bad arguments (missing prompt, unknown agent, etc.)  |
| 124  | Backend was killed by `--timeout`                    |
| 127  | Backend binary not found on PATH                     |
| \*   | Otherwise mirrors the underlying backend's exit code |

## Adapters

Each adapter implements:

```ts
interface Adapter {
  name: string
  binary: string
  build(opts: DispatchOptions): BuiltCommand
  supports(option: 'output' | 'model' | 'cwd'): boolean
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
