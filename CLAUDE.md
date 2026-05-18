# CLAUDE.md — dispatcher-cli

Project conventions for AI coding agents working in this repo. Read this on every new session.
For taste/style decisions, read `docs/conventions.md`. For the full workflow engine, see
`.claude/skills/todo/SKILL.md`.

## Stack at a glance

- **Runtime:** Bun ≥ 1.3 (no Node, no `tsx`/`ts-node`).
- **Language:** TypeScript, strict mode + `noUncheckedIndexedAccess`.
- **Test runner:** `bun:test`.
- **Formatter:** Prettier (config inline in `package.json`). No ESLint, no Biome.
- **CLI parser:** `cac` (do not introduce a second).

## Commands

```bash
bun install                                    # install deps
bun run typecheck                              # tsc --noEmit
bun test                                       # run the suite
bunx prettier --check .                        # format gate
bunx prettier --write <file>                   # apply formatting (also runs via post-edit hook)
bun run build:bin                              # standalone binary → dist/dispatch (then `bun link` to put `dispatch` on PATH)
dispatch exec -a claude "hello"                # run via the PATH-linked binary (prefer this over `bun run dev` or `dist/dispatch`)
```

## Branch + commit conventions

**Branches:** `feat/<slug>` or `feat/<FM-ID>-<slug>` when scoped to one PRD module.
Examples: `feat/timeout-flag`, `feat/FM-005-env-defaults`, `fix/codex-output-warning`.

**Commits:** Conventional Commits, format `type(scope): subject`. The
`.orchestrator/hooks/pre-commit-format.cjs` hook enforces this regex:
`^(feat|fix|refactor|test|docs|chore|perf|build|ci|style|revert)(\([A-Za-z0-9-]+\))?: .+`.

Examples:

- `feat(FM-002): support stdin prompt input`
- `fix(FM-003): clarify error when claude binary missing`
- `refactor(adapters): extract shared BuiltCommand shape`
- `test(adapters): cover passthrough placement for codex`

Scope = FM-ID when the change is tied to one PRD module; otherwise the affected area
(`adapters`, `cli`, `lib`, `docs`, `ci`).

## Orchestrator workflow

When asked to implement a feature or fix from the PRD, use the **todo** skill in
`.claude/skills/todo/SKILL.md`. It manages decomposition, sub-agent delegation, verification,
and commits via the state machine `pending → enriching → architecting → in_progress → verifying
→ done / failed`.

Quick orientation commands:

```bash
node .orchestrator/scripts/task-utils.cjs status               # round summary
node .orchestrator/scripts/task-utils.cjs current              # current active task
node .orchestrator/scripts/task-utils.cjs awaiting-checkpoint  # tasks waiting for approval
```

## Out of scope (PRD-level)

These are hard boundaries — refuse them at enriching time, do not slip them into a task:

- Interactive REPL / chat-mode wrapper.
- Direct HTTP calls to Anthropic / OpenAI APIs (we wrap CLIs only).
- Conversation / session persistence and `--resume` semantics.
- Custom agent implementations beyond the two listed adapters.
- Config files (env vars + flags only for MVP).
- Plugin system.

## Anything else

See `docs/prd.md` for the source-of-truth requirements and `docs/conventions.md` for taste/
style decisions.
