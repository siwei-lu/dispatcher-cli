# dispatcher-cli

## Stack

- Language: TypeScript
- Runtime / package manager: Bun (≥1.3.0)
- CLI framework: cac
- Key dev tools: Prettier, Husky, TypeScript compiler

## Project structure

- `src/` — main source tree (entry: `src/index.ts`)
  - `src/commands/` — one file per CLI subcommand (`exec`, `hook`, `install`, `list`, `update`)
  - `src/adapters/` — agent backend adapters (claude, codex) + registry
  - `src/lib/` — shared utilities (spawn, events, etc.)
- `tests/` — Bun test files, one per source module + fixtures
- `dist/` — compiled standalone binary (git-ignored)

## Build, test, and lint commands

```sh
bun install --frozen-lockfile   # install deps
bun run typecheck               # TypeScript check (no emit)
bun test                        # run all tests
bun run build:bin               # compile to dist/dispatch
bunx prettier --check .         # lint formatting
bunx prettier --write .         # fix formatting
```

## Local run / start

```sh
bun run src/index.ts --help     # run from source
dispatch --help                 # installed binary (if on PATH)
```

No environment variables or credentials required for the CLI itself.
Smoke test: `dispatch --help` prints usage (confirmed working).

## Commit conventions

Conventional Commits with ticket scope: `feat(FM-014): ...`, `fix(scope): ...`, `chore(release): v0.x.y`, `refactor(cli): ...`, `docs(scope): ...`

## Development workflow

- CI runs on push to `main` and PRs: typecheck → test → build:bin → prettier check (matrix: ubuntu + macOS)
- Release pipeline triggers on `v*.*.*` tags: builds cross-platform binaries (darwin-arm64, darwin-x64, linux-x64, linux-arm64) and publishes to GitHub Releases
- Pre-commit hook via Husky (runs on `git commit`)
- agira phases: `pending → in_progress:codex → verifying:haiku → done`
  - `in_progress`: implement in `src/`, write/update tests in `tests/`, confirm `bun test` passes
  - `verifying`: `bun run typecheck && bun test && bun run build:bin && bunx prettier --check .` — all must pass
