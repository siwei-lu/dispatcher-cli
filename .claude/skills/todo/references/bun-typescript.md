# Bun + TypeScript — dispatcher-cli stack notes

Stack-specific quirks the architect and implementer must respect on this project. Treat the
items below as load-bearing — if you ignore them, the code-reviewer will mark a HIGH
"convention violation".

## Runtime

- Bun ≥ 1.3 is the runtime AND the package manager AND the test runner. Do not introduce Node
  shims, `ts-node`, `tsx`, `vitest`, `jest`, or `esbuild`. The whole point of the project is
  Bun-native simplicity.
- `bun` runs TypeScript directly. The `bin` field in `package.json` points at `src/index.ts`,
  not a compiled artifact. `bun build --compile` is reserved for standalone-binary builds via
  `bun run build:bin`.
- Top-level `await` is fine (we use it in `src/index.ts`).

## TypeScript

- `strict: true` AND `noUncheckedIndexedAccess: true`. This means `array[0]` is
  `T | undefined` — handle it explicitly. Do not relax these in `tsconfig.json` without a
  written reason in the PR description.
- `verbatimModuleSyntax: true` — type-only imports must use `import type {...}`.
- `allowImportingTsExtensions: true` and `moduleResolution: "bundler"` — local imports include
  the `.ts` extension explicitly (e.g., `from './adapters/registry.ts'`). Keep this convention.
- JSON imports use the import-attribute form: `import x from './x.json' with { type: 'json' }`.

## Subprocesses

- Use `Bun.spawn` (not `child_process`) for spawning agent backends. Reference:
  `src/lib/spawn.ts`.
- Default to `stdin: 'inherit', stdout: 'inherit', stderr: 'inherit'` for streaming pass-
  through. Buffering breaks the "stream tokens as they arrive" experience that motivated this
  project.
- Forward `SIGINT` and `SIGTERM` from the dispatcher process to the spawned child. If you
  forget, Ctrl-C feels broken to the user.
- For probing (e.g., `--version` for `dispatch list`), `stdout: 'pipe'` is fine — those calls
  are short and we want the output.

## CLI parsing (`cac`)

- All subcommand wiring lives in `src/index.ts`. Add new commands as separate `cli.command(...)`
  blocks; do not in-line implementations in `index.ts` — keep bodies in `src/commands/<name>.ts`.
- The `--` passthrough split is done manually (see `splitPassthrough` in `src/index.ts`)
  **before** handing argv to `cac`. Anything after `--` must NOT reach `cac.parse`.
- Don't introduce a second parser library. `cac` is small and sufficient.

## Testing

- `bun:test` only. Pattern: `import { describe, expect, it } from 'bun:test'`.
- Test files live in `tests/<area>.test.ts`. Each adapter or library module should have its
  own test file as it gains complexity.
- Cover the adapter's `build()` output exactly (command + args + cwd) rather than mocking
  subprocess execution. Subprocess execution itself is exercised only by manual smoke runs and
  CI acceptance steps.

## Formatting

- Prettier with the config in `package.json`:
  - `semi: false` (NO semicolons; rely on ASI)
  - `singleQuote: true`
  - `trailingComma: "all"`
  - `printWidth: 80`
  - `tabWidth: 2`
  - `arrowParens: "always"`
- The `post-edit-format.cjs` hook runs `bunx prettier --write <file>` after every Write/Edit.
  You may notice your code reformatted between turns — that's expected.
- Lint = `bunx prettier --check .`. There is no ESLint or Biome. If you want stricter linting,
  propose it as a separate task; do not silently add a dependency.

## Error handling

- The CLI's failure modes are documented in `README.md` → Exit Codes. Treat that table as a
  contract:
  - 0 = backend ok, 1 = internal, 2 = bad args, 124 = timeout, 127 = backend missing, \* =
    mirror backend.
- All user-facing errors go to stderr with the prefix `dispatch: ` (see existing call sites in
  `src/`). Keep this consistent — scripts piping our output rely on the prefix.

## Adding a new adapter (recipe)

1. Create `src/adapters/<name>.ts` with `name`, `binary`, `build(opts)`, `supports(option)`.
2. Register it in `src/adapters/registry.ts` (`adapters` record).
3. Add tests in `tests/adapters.test.ts` (or a sibling test file) mirroring the claude/codex
   coverage: default build, model+output mapping, passthrough placement, cwd forwarding,
   `supports()` matrix.
4. Update the README's example section if the new adapter has notable behavior.
5. Verify with `dispatch list` that the new adapter appears with the correct version.

This recipe is enforced by the project-specific code review rules in `SKILL.md`.
