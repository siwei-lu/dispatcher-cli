# dispatcher-cli

Call Codex from Claude Code without leaving your session.

Pick the model that is better at this refactor, review, or test failure without
restarting the conversation. Works the other way too: call Claude Code from
Codex CLI with the same `dispatch exec` command.

```bash
dispatch exec -a codex "review this diff for regressions"
echo "summarize README" | dispatch exec -a claude
dispatch list
```

## Why

AI coding agents are good at different kinds of work. When you are deep in
Claude Code and want a second agent to inspect a diff, draft a plan, or chase a
focused bug, `dispatch exec -a codex ...` hands that subtask to Codex without
leaving the current terminal session.

The main workflow is Claude Code driving Codex subagents:

```bash
dispatch exec -a codex "find the bug in the failing auth tests"
dispatch exec -a codex "review the unstaged diff for regressions"
dispatch exec -a codex "implement the small docs cleanup in README.md"
```

The reverse is supported too:

```bash
dispatch exec -a claude "explain the architecture of this repo"
```

## Install

Download the standalone `dispatch` binary from the GitHub Releases page:

<https://github.com/siwei-lu/dispatcher-cli/releases>

Pick the asset for your machine, make it executable, and put it somewhere on
your `PATH`:

```bash
# macOS Apple Silicon
curl -L https://github.com/siwei-lu/dispatcher-cli/releases/latest/download/dispatch-darwin-arm64 -o dispatch
chmod +x dispatch
sudo mv dispatch /usr/local/bin/dispatch
```

Available release assets:

- `dispatch-darwin-arm64`
- `dispatch-darwin-x64`
- `dispatch-linux-x64`
- `dispatch-linux-arm64`

You also need the backend CLIs you want to call:

- `codex` for OpenAI Codex CLI
- `claude` for Claude Code

Check what `dispatch` can see:

```bash
dispatch list
```

### Build From Source

```bash
bun install
bun run build:bin
./dist/dispatch list
```

## Use It Inside Claude Code

Put this in your project `CLAUDE.md` or global Claude Code instructions:

```markdown
## Subagents

For subagent work, run dispatch from Bash:

`dispatch exec -a codex "<task>"`

Use this instead of spawning an AI coding subagent directly. Run it in the
background so Claude Code can continue while Codex works, and check the command
progress or output anytime.
```

Example prompts that work well:

```bash
dispatch exec -a codex "review the current git diff for correctness issues"
dispatch exec -a codex "find why bun test is failing and suggest the smallest fix"
dispatch exec -a codex "inspect src/adapters and propose a safe refactor plan"
```

## Enforce Background Dispatch In Claude Code

Run this once:

```bash
dispatch install
```

`dispatch install` registers a Claude Code `PreToolUse` Bash hook. When Claude
Code tries to run `dispatch exec` in the foreground, the hook blocks it and asks
Claude to re-run the command with `run_in_background: true`.

That matters because delegated agent work can take minutes. Running it in the
background lets the main Claude Code session keep moving while the Codex or
Claude subagent works. You can inspect progress and output from the background
Bash command whenever you want.

Use project scope if you only want the hook in the current git repo:

```bash
dispatch install --scope project
```

Remove it later with:

```bash
dispatch uninstall
dispatch uninstall --scope project
```

## Why Not MCP For This?

For this handoff workflow, `dispatch` intentionally uses shell execution instead
of MCP bridges such as `codex mcp-server` or `codex-as-mcp`.

MCP bridges can leave the parent agent waiting on a tool call with little useful
progress visibility. A background `dispatch exec` is just a shell job: Claude
Code can keep working, and you can check the running command's output whenever
you need it.

## Usage

```text
Usage: dispatch <command> [options]

Commands:
  exec [...prompt]                      Run a non-interactive prompt against an AI coding agent
  list                                  Show available agent backends and their status
  hook <name>                           Run a dispatch hook handler
  install [--scope global|project]      Register the Claude Code background hook
  uninstall [--scope global|project]    Remove the Claude Code background hook
  update [--check] [--version <tag>] [--prerelease]  Self-update the dispatch binary from GitHub Releases

Common exec options:
  -a, --agent <name>            Agent backend (claude|codex)
  -m, --model <model>           Model identifier passed to the backend
  -C, --cwd <dir>               Working directory for the spawned process
      --timeout <ms>            Abort backend if it exceeds this duration
      --log-file <path>         Write rendered output to file; stdout becomes a JSON exit envelope
      --progress-format <fmt>   Emit raw DispatcherEvents as JSON lines to stderr (only: json)
  --                            Forward everything after this verbatim to the backend
```

### Prompt Input

Pass the prompt as arguments:

```bash
dispatch exec -a codex "summarize this repo"
```

Or pipe it through stdin:

```bash
cat README.md | dispatch exec -a claude
```

### Environment Defaults

| Variable         | Effect                              |
| ---------------- | ----------------------------------- |
| `DISPATCH_AGENT` | Default agent when `-a` is omitted. |
| `DISPATCH_MODEL` | Default model passed to the agent.  |

CLI flags override environment variables.

## Output

`dispatch exec` streams progress as bracketed events:

```text
[task] review this diff for regressions
[start] codex
[tool] shell: git diff --stat
[done] The diff looks safe, but add a test for...
```

Write the rendered stream to a file and return a compact JSON envelope on
stdout:

```bash
dispatch exec -a codex "review this diff" --log-file /tmp/dispatch.log
```

Emit raw machine-readable events:

```bash
dispatch exec -a codex "fix the bug" --progress-format json 2>events.ndjson
```

## What This Is Not

`dispatcher-cli` is not a chat UI, agent runtime, or session manager. It does
not persist conversations and does not call model APIs directly.

It wraps installed AI coding CLIs in non-interactive mode:

- Claude Code via `claude -p`
- Codex CLI via `codex exec`

## Exit Codes

| Code | Meaning                                                                                 |
| ---- | --------------------------------------------------------------------------------------- |
| 0    | Backend exited cleanly                                                                  |
| 1    | Unknown top-level command, flag pre-condition failure, or dispatcher-cli internal error |
| 2    | Bad arguments to a known subcommand                                                     |
| 124  | Backend was killed by `--timeout`                                                       |
| 127  | Backend binary not found on `PATH`                                                      |
| \*   | Otherwise mirrors the underlying backend's exit code                                    |

## Develop

```bash
bun install
bun test
bun run typecheck
bun run dev exec -a claude "hi"
```

## Releases

Push a semver tag to publish a release:

```bash
git tag v0.6.0
git push origin v0.6.0
```

GitHub Actions runs the test suite, builds standalone binaries for macOS and
Linux, and attaches them to the GitHub Release.
