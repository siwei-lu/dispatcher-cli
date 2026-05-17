# tasks.json Schema

This is the canonical schema for `.orchestrator/tasks.json`. All agents and hooks must parse this
structure consistently.

## Top-Level Structure

```json
{
  "requirements": {
    "original_input": "The raw input the user provided (ticket number, PRD text, plain text)",
    "input_type": "jira | github | prd | plain_text",
    "clarification_log": [
      { "round": 1, "questions": ["..."], "answers": ["..."] }
    ],
    "final_requirements": "The interpreted requirements after clarification",
    "branch": "feat/PROJ-123-add-dark-mode"
  },
  "created_at": "2026-04-02T10:00:00Z",
  "housekeeper_cycle_count": 0,
  "max_housekeeper_cycles": 3,
  "max_retries": 3,
  "tasks": [
    {
      /* task object — see below */
    }
  ]
}
```

## Task Object

```json
{
  "id": "task-001",
  "title": "Implement user registration endpoint",
  "description": "Create POST /register endpoint with email uniqueness check and JWT response",
  "state": "pending",
  "assignee": "implementer",
  "model": "sonnet",
  "source": "user",
  "prd_module_id": "FM-001",
  "dependencies": [],
  "retry_count": 0,
  "enrichment": {
    "prd_source": "docs/prd.md:FM-001",
    "confidence": "high",
    "prd_refs": ["用户名长度 6-20 位...", "同一邮箱不允许重复注册，返回 409"],
    "acceptance_criteria": [
      "POST /register 返回 201 + JWT",
      "重复邮箱返回 409"
    ],
    "awaiting_confirmation": false,
    "implementation_certainty": "high",
    "impact_scope": 2,
    "needs_checkpoint": false,
    "checkpoint": null,
    "acceptance_steps": [
      /* see Acceptance Step Objects section */
    ]
  },
  "architecture": {
    /* see Architecture Object section — null until architecting completes */
  },
  "verification_results": [],
  "history": [
    {
      "from_state": null,
      "to_state": "pending",
      "timestamp": "2026-04-02T10:00:00Z",
      "reason": "Task created"
    }
  ]
}
```

## Field Definitions

### Task Fields

| Field                  | Type         | Required                                                                                                                                                                                  | Description                                                                                                                          |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | string       | yes                                                                                                                                                                                       | Unique identifier (e.g., `task-001`)                                                                                                 |
| `title`                | string       | yes                                                                                                                                                                                       | Short human-readable title                                                                                                           |
| `description`          | string       | yes                                                                                                                                                                                       | Detailed description of what needs to be done                                                                                        |
| `state`                | string       | yes                                                                                                                                                                                       | Current state in the state machine                                                                                                   |
| `assignee`             | string       | yes                                                                                                                                                                                       | Sub-agent role: `architect`, `implementer`, `code_reviewer`, `pm_tester`, `qa_verifier`, `housekeeper`                               |
| `model`                | string       | yes                                                                                                                                                                                       | Claude model: `opus`, `sonnet`, `haiku`                                                                                              |
| `source`               | string       | yes                                                                                                                                                                                       | Who created this task: `"user"` or `"housekeeper"`                                                                                   |
| `prd_module_id`        | string       | no                                                                                                                                                                                        | FM-ID from PRD (e.g., `"FM-001"`). Set during task decomposition when PRD uses standard schema. Enables precise enrichment matching. |
| `dependencies`         | string[]     | no                                                                                                                                                                                        | IDs of tasks that must be `done` before this one starts                                                                              |
| `retry_count`          | number       | yes                                                                                                                                                                                       | How many times this task has been retried (max from config)                                                                          |
| `enrichment`           | object       | yes                                                                                                                                                                                       | PRD context and acceptance criteria (see below)                                                                                      |
| `architecture`         | object\|null | Implementation spec produced by architect agent. Contains component breakdown, resolved decisions, DOM structure, state management, data flow. `null` until architecting state completes. |
| `verification_results` | array        | yes                                                                                                                                                                                       | Results from each verification attempt                                                                                               |
| `history`              | array        | yes                                                                                                                                                                                       | State transition log with timestamps                                                                                                 |

### Enrichment Object

| Field                      | Type         | Description                                                                                                                                                                                                                             |
| -------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prd_source`               | string       | Where the data came from: `"prd.md:FM-001"` (standard schema match), `"prd.md"` (freeform match), `"jira:PROJ-123"`, `"inferred"`, `"user_provided"`, `"none"`                                                                          |
| `confidence`               | string       | Enriching agent's self-assessment: `"high"` or `"low"`                                                                                                                                                                                  |
| `prd_refs`                 | string[]     | Verbatim PRD fragments relevant to this task. Never paraphrased.                                                                                                                                                                        |
| `acceptance_criteria`      | string[]     | Verifiable conditions that must be true for this task to be `done`                                                                                                                                                                      |
| `awaiting_confirmation`    | boolean      | `true` when paused for human confirmation (confidence = low path)                                                                                                                                                                       |
| `implementation_certainty` | string       | `"high"` or `"low"`. How many reasonable implementation paths exist for this task.                                                                                                                                                      |
| `impact_scope`             | number       | Estimated number of files/modules affected.                                                                                                                                                                                             |
| `needs_checkpoint`         | boolean      | `true` when the task should pause for human approval of the implementation approach before coding begins.                                                                                                                               |
| `checkpoint`               | object\|null | Implementation brief for human review. `null` if `needs_checkpoint` is `false`.                                                                                                                                                         |
| `acceptance_steps`         | array        | Executable test steps for PM agent. Generated by enricher based on `acceptance_testing` strategy in `project.config.json`. **Must be non-empty when config exists** (see invariant 15). Empty only when no `acceptance_testing` config. |

### Acceptance Step Objects

Each step has: `type`, `description`, type-specific fields, `assert[]`, and `evidence`.

**Common fields:** All types have `description` (string), `assert` (array of `{condition, value}`),
`evidence` (`"screenshot"` | `"response_body"` | `"terminal_output"`).

**Type-specific fields:**

- `ui`: `actions[]` — sequence of `{action, target/selector/value}`. Actions: `navigate`, `fill`, `click`, `wait`. Assert conditions: `url_contains`, `element_visible`, `element_text`, `css_property`.
- `api`: `method`, `path`, `body`. Assert conditions: `status`, `body_contains`, `header_contains`.
- `cli`: `command`. Assert conditions: `exit_code`, `stdout_contains`, `stderr_contains`.

**Example (API step):**

```json
{
  "type": "api",
  "description": "Register returns 201 with JWT",
  "method": "POST",
  "path": "/register",
  "body": { "email": "test@test.com", "password": "Test1234" },
  "assert": [
    { "condition": "status", "value": 201 },
    { "condition": "body_contains", "value": ["userId", "token"] }
  ],
  "evidence": "response_body"
}
```

**Enricher rules for generating acceptance_steps:**

1. Read `acceptance_testing` from `project.config.json`. If the config exists, steps 2-5 are
   **mandatory** — empty `acceptance_steps` is an enrichment failure that the planner must reject.
2. Convert each `acceptance_criteria` string into one or more executable steps. Every criterion
   must map to at least one step. If a criterion cannot be converted to an executable step
   (e.g., "code is clean"), either make it concrete ("no lint errors") or drop it from steps
   and note why.
3. Each step must have at least one `assert` and one `evidence` type
4. Use relative paths in `path` and `target` fields (e.g., `/register`, not `http://localhost:3000/register`).
   The PM agent prepends `acceptance_testing.base_url` at execution time.
5. If strategy is `hybrid`, tag each step with the appropriate `type`
6. If no `acceptance_testing` config exists, set `acceptance_steps: []`

### Architecture Object

Produced by architect, completed by planner. Implementer's primary instruction — it translates
this spec into code without making its own decisions.

| Field              | Type         | Description                                        |
| ------------------ | ------------ | -------------------------------------------------- |
| `components`       | string[]     | Files/components to create or modify               |
| `decisions`        | array        | Every micro-decision: `{question, answer, source}` |
| `dom_structure`    | string\|null | UI tasks: component tree / DOM hierarchy           |
| `state_management` | string\|null | How state is managed                               |
| `data_flow`        | string\|null | User action → API → state → UI update              |
| `notes`            | string\|null | Anything else the implementer needs                |

**Decision `source` values:** `"conventions.md"`, `"memory"`, `"user"`, `"architect"` (low-stakes
only), `"unresolved"` (needs planner input).

**Rules:**

1. List ALL decisions — even obvious ones. No silent choices.
2. User-facing decisions (UI behavior, copy, error handling, data flow) must come from
   conventions, memory, or user — never `"architect"`.
3. Planner resolves `"unresolved"` via: (a) conventions.md, (b) memory, (c) ask user.
   Each resolution is written to memory + conventions.md so it's never asked again.

### Checkpoint Object

Present only when `needs_checkpoint === true`.

| Field           | Type         | Description                               |
| --------------- | ------------ | ----------------------------------------- |
| `approach`      | string       | One sentence: technical direction         |
| `touch_files`   | string[]     | Files/modules to be modified              |
| `risk`          | string\|null | What's uncertain, if anything             |
| `status`        | string       | `"pending"` → `"approved"` or `"revised"` |
| `user_response` | string\|null | Human's feedback if revised               |

**Trigger rules:** `needs_checkpoint = true` when: `implementation_certainty === "low"`, OR
`impact_scope >= 3`, OR `confidence === "low"` with architectural decisions.

**Confidence rules:**

- `high`: task has `prd_module_id` that matches a FM module in a standard-schema PRD (precise match,
  constraints and acceptance criteria come directly from the module), OR ≥2 relevant PRD fragments
  found, OR Jira ticket has an explicit Acceptance Criteria field, OR Jira description is detailed
  (>3 sentences with specific requirements)
- `low`: plain text input, OR 0-1 PRD fragments found, OR Jira description is thin

**Implementation certainty rules:**

- `high`: only one obvious implementation approach, OR a near-identical pattern already exists in the
  codebase, OR the change is mechanical (add field, rename, config change)
- `low`: multiple valid architectural approaches, OR new pattern not yet established in the codebase,
  OR involves a technology choice (which library, which pattern)

### Valid States

States are project-specific (defined in `config.json`), but these are the common ones:

| State               | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `pending`           | Not yet started, waiting for dependencies                   |
| `enriching`         | Extracting PRD refs and deriving acceptance criteria        |
| `architecting`      | Architect scans decisions, planner resolves unknowns        |
| `designing`         | Design/architecture phase (optional, for UI-heavy projects) |
| `implementing`      | Sub-agent is actively writing code                          |
| `in_progress`       | Generic active state (for simple state machines)            |
| `code_review`       | Code reviewer sub-agent is reviewing the diff               |
| `verifying`         | QA sub-agent is running lint/build/test                     |
| `acceptance`        | PM sub-agent is validating against requirements             |
| `device_testing`    | Device-specific testing (mobile projects)                   |
| `done`              | Task completed, committed                                   |
| `failed`            | Task failed after max retries                               |
| `dependency_failed` | Task blocked because a dependency failed                    |

### Valid Assignee Roles

| Role            | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `enricher`      | Extracts prd_refs and derives acceptance_criteria                   |
| `architect`     | Scans task, lists all micro-decisions, proposes implementation spec |
| `implementer`   | Writes code — follows architecture spec, does not make decisions    |
| `code_reviewer` | Reviews diffs                                                       |
| `pm_tester`     | Acceptance testing via MCP                                          |
| `qa_verifier`   | Runs lint/build/test                                                |
| `housekeeper`   | Read-only quality sweep                                             |

### Verification Result Object

Each entry covers one attempt. Omit stages not yet reached. Key fields:

- `attempt` (number), `timestamp`, `overall` (bool)
- `checks`: `{lint, build, test}` — each `{passed, output}`
- `code_review`: `{passed, review_score, threshold, finding_counts, findings}`
- `acceptance`: `{passed, steps_total, steps_passed, results[]}` — each result has
  `{step_description, passed, actual, evidence_type, evidence}`
- On failure: `failure_type` (`"implementation"` → back to implementing, `"criteria"` →
  back to enriching), `failure_reason`

**PM agent rules:** Execute `acceptance_steps` sequentially via MCP. Each step must produce
evidence (no evidence = failed step). Empty steps when config exists = enrichment failure, route
back to enriching. Planner rejects results with empty/missing evidence.

### History Entry

`{from_state, to_state, timestamp, reason}`. When `to_state` is `"done"`, include `commit_hash`.

## Invariants

1. A task in `done` state must have at least one verification result with `overall: true`
2. A task in `failed` state must have `retry_count >= max_retries`
3. A task cannot transition to `implementing` if `enrichment.awaiting_confirmation === true`
4. A task cannot transition to `implementing` if `enrichment.checkpoint?.status === "pending"`
5. A task in `implementing` must have `enrichment` field present (even if `prd_refs: []`)
6. A task in `implementing` with `needs_checkpoint: true` must have `checkpoint.status` = `"approved"` or `"revised"`
7. `confidence: high` must never be set when `prd_refs.length === 0` AND `prd_source` is not a Jira ticket
8. `housekeeper_cycle_count` must never exceed `max_housekeeper_cycles`
9. Tasks with `source: "housekeeper"` can only be created by the planner after reviewing housekeeper findings
10. State transitions must be recorded in `history` — no silent state changes
11. Enriching agent must not modify any fields outside of `enrichment`, `state`, and `history`
12. When acceptance fails with `failure_type: "criteria"`, the task must transition to `enriching` (not `implementing`)
13. A task transitioning to `done` must have a corresponding git commit. The planner executes the commit, not the implementer. Code is uncommitted during all states before `done`.
14. If the state machine includes `acceptance`, the verification result must contain an `acceptance` block with `results` array where every entry has non-empty `evidence`. Empty evidence = planner rejects and re-runs acceptance.
15. If `project.config.json` has `acceptance_testing` config, a task cannot enter `acceptance` with empty `acceptance_steps`. Empty steps when config exists = enrichment failure → planner routes task back to `enriching`.
16. If the state machine includes `architecting`, a task cannot enter `implementing` with `architecture: null` or any decision with `source: "unresolved"`. All decisions must be resolved before code is written.
