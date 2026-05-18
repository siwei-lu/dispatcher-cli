# Conventions — dispatcher-cli

This file captures taste / style decisions specific to dispatcher-cli. It grows over time:
every time a question is answered by the user (or settled by a design call), record the
decision here so the architect and code-reviewer can apply it without re-asking.

Format per entry: **decision** → **why** → **how to apply / counter-example**.

## Interaction Patterns

- **Bare `dispatch` invocation prints help, exit 0.** Why: avoids surprising scripts that
  accidentally invoke `dispatch` with no args; matches `npm`, `cargo`, `git`. How: see
  `main()` in `src/index.ts` — the "no cliArgs" branch calls `cli.outputHelp()` and returns 0.
  Counter-example: don't make bare `dispatch` enter an interactive picker.
- **Unknown subcommand → exit 1, stderr message, hint at `--help`.** Why: silent fall-through
  is the worst CLI UX. How: see the matched-command guard in `src/index.ts`.

## Output Style

- **All error messages go to stderr with the `dispatch: ` prefix.** Why: pipelines grepping
  output can distinguish dispatcher-cli messages from backend output. How: `process.stderr.write(\`dispatch: ${msg}\n\`)`.
- **Streaming over buffering.** Why: agents are interactive — users want to see tokens as
  they appear. How: `Bun.spawn` with `stdout: 'inherit'`. Never `await new Response(proc.stdout).text()` in the hot path.
- **No emoji in CLI output unless the user explicitly asked for it.** Why: many terminals,
  CI logs, and downstream parsers handle them poorly. How: plain ASCII for `dispatch list`,
  errors, and help text.
- **An adapter that cannot honor a unified flag must emit a `dispatch: ` stderr notice and
  continue; never silently drop.** Why: silent drops violate the principle of least surprise
  — if a user passed a flag, they expect acknowledgement either way. How: see
  `src/adapters/codex.ts` for the `--output` case (warns for any value, including `text`).

## Data & State

- **Env vars override config defaults; CLI flags override env vars.** Why: standard Unix
  precedence. How: `defaultAgent()` and `defaultModel()` in `src/lib/config.ts` read env, and
  `runExec()` lets the parsed flag win (`args.agent ?? defaultAgent()`).
- **No persistent state in MVP.** Why: dispatch is a stateless wrapper — adding state means
  conversation persistence, which is explicitly out of scope. How: never write to
  `~/.config/dispatcher-cli/` or any local file from the runtime path.

## Copy & Tone

- **Help text and error messages use lowercase sentences without trailing periods on short
  fragments,** but full-sentence guidance ends with periods. Why: matches the existing tone in
  `cac` output, claude / codex, and most modern CLIs. Examples:
  - good: `dispatch: no prompt provided. Pass it as an argument or via stdin.`
  - good: `Working directory for the spawned process`
  - bad: `Dispatch: No prompt provided!`
- **Be concrete about what to do next.** When emitting an error, include the fix. E.g.,
  "claude binary not found on PATH — install it from
  https://docs.claude.com/en/docs/claude-code/setup and try again."

## cac Quirks

- **`--version` is a reserved option name in cac.** `cli.version()` registers a global `--version`
  (boolean) that shadows any subcommand option also named `--version`. To add a `--version <tag>`
  flag on a subcommand (e.g. `dispatch update`), remove `cli.version()` and handle the global
  `-v / --version` case manually before the `cli.parse()` call:
  ```typescript
  const hasSubcommand = cliArgs.length > 0 && !cliArgs[0]?.startsWith('-')
  if (
    !hasSubcommand &&
    (cliArgs.includes('--version') || cliArgs.includes('-v'))
  ) {
    process.stdout.write(pkg.version + '\n')
    return 0
  }
  ```
  Side effect: cac suppresses `--version <tag>` from the subcommand's help output (it still
  parses correctly). Document the flag in the README commands table instead.

## Code Style

- Prettier rules (`package.json#prettier`) are non-negotiable. No semicolons, single quotes,
  trailing commas everywhere, 80-column lines, 2-space indent, parens around arrow params.
- Type-only imports use `import type { ... }` (verbatimModuleSyntax is on).
- Local imports use explicit `.ts` extensions.
- Don't add comments that restate what the code says. Reserve comments for the why behind
  surprising decisions.

---

_This file is read by the architect (during architecting) and the code reviewer (during
verifying). When a decision becomes a recurring discussion, add it here._
