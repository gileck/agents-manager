---
name: audit-architecture
description: Architecture health audit — checks abstractions, layer boundaries, registration points, docs accuracy, and code duplication. Use when the user says "audit architecture", "audit abstractions", "check architecture", "architecture health", or wants to verify the codebase follows its documented architecture.
user-invocable: true
---

# Audit Architecture

Comprehensive architecture health audit. Verifies that abstractions are intact, layer boundaries are respected, registration points are pure, documentation matches reality, and there is no inappropriate code duplication.

## What This Skill Does

Reads `docs/abstractions.md` and the architecture docs, then systematically runs checks across multiple scopes. Reports findings as a structured audit with PASS/FAIL/WARN per check.

## How to Invoke

- `/audit-architecture` — run all checks across all scopes
- `/audit-architecture abstractions` — only abstraction integrity checks (Checks 1, 2, 5, 8, 12)
- `/audit-architecture layers` — only layer boundary checks (Checks 3, 4, 6, 7)
- `/audit-architecture registration` — only registration point checks (Checks 9, 10)
- `/audit-architecture docs` — only documentation accuracy checks (Check 11)
- `/audit-architecture <AbstractionName>` — all checks for a specific abstraction (e.g., `/audit-architecture AgentLib`)

## Audit Process

Follow these steps in order:

### Step 1: Load the architecture definitions

Read `docs/abstractions.md` to get the full list of abstractions. Each abstraction defines:
- **What it separates** (the two sides)
- **Interface file** (the contract)
- **Implementation files** (the concrete classes)
- **Registry/factory** (how implementations are selected)

### Step 2: Run checks

Run the checks for the requested scope (or all checks if no scope specified). Use the Agent tool with subagent_type "Explore" to parallelize where possible.

## Check Scopes

### Scope: abstractions

Checks that interface-based abstractions are intact — no leaks, no bypasses.

Checks: 1, 2, 5, 8, 12

### Scope: layers

Checks that architectural layer boundaries are respected — transport, persistence, rendering.

Checks: 3, 4, 6, 7

### Scope: registration

Checks that registration/wiring points are pure and documented.

Checks: 9, 10

### Scope: docs

Checks that architecture documentation matches reality.

Checks: 11

## All Checks

---

#### Check 1: No direct implementation imports (the core leak check)

The most important check. Code that should depend on the interface must NOT import the concrete implementation directly.

**How to check:** For each abstraction, grep for imports of the implementation class in files that should only know about the interface.

**Rules:**
- Files in `src/core/services/` should import store **interfaces** (e.g., `ITaskStore`), never the concrete `SqliteTaskStore`
- Files in `src/core/services/` should import `IAgentLib`, never `ClaudeCodeLib` or `CursorAgentLib` directly (except `agent-lib-registry.ts`)
- Files in `src/core/agents/` should import `IAgentLib`, never concrete libs
- Files in `src/core/services/` should import `IGitOps`, `IScmPlatform`, `IWorktreeManager` — never `LocalGitOps`, `GitHubScmPlatform`, `LocalWorktreeManager`
- Files in `src/core/handlers/` should import interfaces, not implementations

**Allowed exceptions:**
- Test files (`*.test.ts`, `*.spec.ts`) — always allowed
- Registration points documented in `docs/abstractions.md` — but only if they pass Check 9 (pure wiring, no business logic) and Check 10 (documented)

Any file that imports concrete implementations but is NOT a test file and NOT a documented, verified registration point is a violation.

**What to grep for (examples):**
```
# For store abstractions - find imports of sqlite implementations
import.*from.*sqlite-task-store
import.*from.*sqlite-project-store

# For AgentLib - find imports of concrete libs
import.*from.*claude-code-lib
import.*from.*cursor-agent-lib
import.*from.*codex-cli-lib

# For Git abstractions
import.*from.*local-git-ops
import.*from.*github-scm-platform
import.*from.*local-worktree-manager

# For NotificationRouter
import.*from.*telegram-notification-router
import.*from.*stub-notification-router
```

**FAIL if:** Any file outside the allowed exceptions imports a concrete implementation instead of the interface. Report the file, line, and what it should import instead.

---

#### Check 2: Constructor parameter types use interfaces

Services and handlers should declare their dependencies using interface types, not concrete types.

**How to check:** Read the constructor of each major service and verify that parameter types reference interfaces (e.g., `ITaskStore`, not `SqliteTaskStore`).

**Files to check:**
- All files in `src/core/services/` that have constructors
- `src/core/handlers/*.ts` — function parameters

**FAIL if:** A constructor or function parameter uses a concrete type instead of its interface.

---

#### Check 3: No business logic in transport/client layers

The WorkflowService abstraction separates business logic from client transport. Business logic must NOT exist in:
- `src/main/ipc-handlers/` (Electron IPC handlers)
- `src/cli/` (CLI commands)
- `src/daemon/routes/` (daemon HTTP routes)
- `src/web/` (web UI shim)

**How to check:** Read the IPC handlers, CLI commands, and daemon routes. They should be thin wrappers that:
1. Extract parameters from the request
2. Call a WorkflowService (or other service) method
3. Return the result

**FAIL if:** A route handler, IPC handler, or CLI command contains business logic (DB queries, complex conditionals, multi-step orchestration, direct instantiation of core services) instead of delegating to a service.

---

#### Check 4: No SQLite/DB imports outside stores and setup

The store abstraction means SQL and database access should be confined to store files and DB infrastructure.

**How to check:** Grep for these patterns across the entire `src/` directory:
- `better-sqlite3` imports
- `Database.Database` type references
- `.prepare(` calls
- Direct SQL strings (`SELECT `, `INSERT `, `UPDATE `, `DELETE `, `CREATE TABLE`)

Then check where each match appears. The ONLY places these should exist are:
- `src/core/stores/` (store implementations)
- `src/core/providers/setup.ts` (composition root)
- Files whose sole purpose is DB infrastructure (schema, migrations, DB initialization) — identify these by reading the file, don't assume a fixed list
- Test files

**FAIL if:** SQL queries or direct DB access appear in any other file. Report each violation with its file, line, and a suggested fix.

**Suggestion for violations:** If a service needs transactional guarantees across multiple stores, suggest introducing a method on the relevant store that encapsulates the multi-table write, or a dedicated transaction-aware service method that coordinates stores — rather than having the service use raw SQL directly.

---

#### Check 5: No engine-specific code in agents or prompt builders

The AgentLib abstraction means agent code should be engine-agnostic. Prompt builders and the Agent class should never reference Claude SDK types, Codex types, or Cursor types.

**How to check:** Grep for engine-specific imports in `src/core/agents/`:
- `@anthropic-ai/claude-code` (Claude SDK)
- `codex` / `codex-cli`
- `cursor`
- Any engine-specific type names (check what types the concrete libs export and search for those)

**FAIL if:** Agent or prompt builder code imports or references engine-specific types.

---

#### Check 6: No platform-specific code in services using ScmPlatform/GitOps

Services that use `IGitOps` or `IScmPlatform` should not contain GitHub-specific logic, `gh` CLI calls, or raw `git` shell commands.

**How to check:** Grep for these patterns in service files (excluding the GitOps/ScmPlatform implementations themselves):
- Shell execution with git/gh: `execSync`, `spawn`, `exec`, `child_process` combined with `git` or `gh` arguments
- Raw git/gh command strings: `'git `, `"git `, `'gh `, `"gh `
- GitHub-specific API references

**FAIL if:** A service file shells out to `git` or `gh` directly instead of using IGitOps/IScmPlatform.

---

#### Check 7: Renderer/UI does not import core services or implementations

The client-daemon convergence means the renderer should access functionality via `window.api` (which goes through IPC to the daemon), not by importing core modules directly.

**How to check:** Grep for imports from `src/core/` in `src/renderer/` files.

**Distinguish between:**
- **Type-only imports** (`import type { ... } from 'src/core/...'`) — these are potentially acceptable since types are erased at runtime and don't create a runtime dependency. However, still flag them and note whether the type could come from `src/shared/` instead.
- **Value imports** (`import { ... } from 'src/core/...'`) — these are always a violation. The renderer should never import runtime values from core.

**FAIL if:** Any renderer file imports runtime values from `src/core/`.
**WARN if:** Any renderer file imports types from `src/core/` that could instead come from `src/shared/`.

---

#### Check 8: Interface completeness

Every interface in `src/core/interfaces/` should have at least one implementation.

**How to check:** For each interface file, search for classes or objects that implement it across `src/core/services/` and `src/core/stores/`.

**FAIL if:** An interface exists with no implementation (orphaned interface).

---

#### Check 9: Registration points are pure wiring (no business logic)

Files that are allowed to import concrete implementations (setup.ts, agent-lib-registry.ts) must contain ONLY wiring/registration code — instantiation, dependency injection, and registration calls. They must NOT contain business logic.

**How to check:** Read each registration point file and look for:
- Conditional logic based on runtime data (business decisions)
- Data transformation or processing
- Error handling beyond construction failures
- Calls to external services or APIs
- Complex orchestration or sequencing beyond "create X, pass to Y"

**What IS acceptable in registration points:**
- `new ConcreteClass(dependency1, dependency2)` — instantiation
- `registry.register('name', instance)` — registration
- Factory functions that return `new ConcreteClass(...)` — scoped instantiation
- Importing concrete classes to wire them to interfaces

**What is NOT acceptable:**
- Business rules ("if task status is X, then...")
- Data queries or DB access beyond what's needed for initialization
- Calling service methods to perform operations
- Side effects beyond wiring (logging during normal flow, notifications, etc.)

**FAIL if:** A registration point file contains business logic mixed with wiring code. Suggest extracting the logic into the appropriate service.

---

#### Check 10: Registration points are documented

Every file that imports concrete implementations (the registration/wiring points) must be documented in `docs/abstractions.md`.

**How to check:**
1. From Check 1, collect all files that import concrete implementations (excluding test files)
2. Read `docs/abstractions.md` and collect all files mentioned as registration points (Registry, Factory, or composition root entries)
3. Compare: every file found in step 1 should appear in step 2

**FAIL if:** A file imports concrete implementations but is not documented as a registration point in `docs/abstractions.md`. This means either:
- The file is an undocumented leak (should not import concrete implementations), OR
- The file is a legitimate registration point that is missing from the docs (docs need updating)

Report which case it is based on whether the file contains pure wiring or business logic (use Check 9 results).

---

#### Check 11: Documentation completeness and accuracy

`docs/abstractions.md` must accurately describe each abstraction with all three layers:

1. **App logic** — which services/files consume the interface (the "users" of the abstraction)
2. **Abstraction pieces** — the interface, its implementations, and any base classes
3. **Registration points** — where concrete implementations are wired to interfaces (setup.ts, registries, factories)

**How to check:** For each abstraction documented in `docs/abstractions.md`:

1. **Verify interface file exists** — read the file path mentioned. Does it exist? Does it define the interface mentioned?
2. **Verify implementation files exist** — read each implementation file path. Does it exist? Does it implement the interface?
3. **Verify registration/factory exists** — read the registry/factory file. Does it exist? Does it wire this abstraction?
4. **Check for undocumented implementations** — grep for `implements <InterfaceName>` or classes that extend the base class. Are there implementations not mentioned in the docs?
5. **Check for undocumented consumers** — which services import and use this interface? Are the key consumers mentioned?
6. **Verify "What it separates" is accurate** — does the actual code match the described separation? For example, if the doc says "separates X from Y", verify that the interface boundary actually achieves this separation.

**FAIL if:**
- A documented file path doesn't exist or doesn't match what's described
- An implementation exists but isn't mentioned in the docs
- A registration point exists but isn't documented
- The "What it separates" description doesn't match reality (e.g., the interface leaks details from the side it's supposed to hide)

**WARN if:**
- Key consumers of the interface are not mentioned (the docs describe the abstraction pieces but not who uses them)

---

#### Check 12: No code duplication across abstraction implementations

When multiple implementations of the same interface contain duplicated logic, that logic should be extracted — either into the base class / shared utility (if it's generic) or into the app-level service that consumes the interface (if it's domain logic).

**How to check:** For each abstraction that has multiple implementations (AgentLib, stores with similar patterns, GitOps/ScmPlatform, NotificationRouter), compare the implementations side by side and look for:

- **Identical or near-identical methods** — same logic copy-pasted across implementations
- **Shared validation or transformation** — the same input parsing, data shaping, or error mapping in multiple implementations
- **Repeated patterns** — same try/catch structure, same logging, same fallback logic across implementations

**For each duplication found, determine where it belongs:**

1. **Base class** — if the logic is shared infrastructure that all implementations need (e.g., timeout handling, abort signal wiring, telemetry collection). Check whether a base class already exists (e.g., `BaseAgentLib`) and whether the duplicated logic should live there.
2. **Utility function** — if the logic is generic and not specific to the abstraction (e.g., string formatting, path manipulation, retry logic). Suggest extracting to a shared utility file.
3. **App-level service** — if the logic is domain/business logic that leaked into implementations. For example, if two AgentLib implementations both compute "which tools to allow based on agent type", that's business logic that belongs in the service layer, not in the engine implementations.

**FAIL if:** Significant duplicated logic exists across implementations that could be extracted without breaking the abstraction boundary. Report the duplicated code locations and suggest where it should live.

**WARN if:** Minor duplication exists (e.g., similar error messages, small boilerplate) that may not be worth extracting.

---

### Step 3: Save the full report

Save the full detailed report to `docs/audits/architecture-audit-<YYYY-MM-DD>.md` (use today's date). Create the `docs/audits/` directory if it doesn't exist. If a file with today's date already exists, overwrite it.

The full report should contain all details needed to act on every finding:

```markdown
# Architecture Audit Report — YYYY-MM-DD

## Summary
- Scopes checked: abstractions, layers, registration, docs
- Total checks run: X
- Passed: X
- Failed: X
- Warnings: X

## Abstraction Integrity

### 1. AgentLib — Agent Logic vs AI Engine
- [PASS] No direct implementation imports (Check 1)
- [PASS] Constructor types use interfaces (Check 2)
- [FAIL] Engine-specific code in agents (Check 5)
  - src/core/agents/agent.ts:42 imports ClaudeCodeLib directly
  - Fix: Import IAgentLib instead, resolve via registry

### 2. Data Stores — Domain Logic vs Persistence
- [PASS] No SQLite imports outside stores (Check 4)
- [PASS] Constructor types use interfaces (Check 2)
...

## Layer Boundary Violations
(Check 3, 4, 6, 7 results with file:line and suggested fixes)

## Registration Point Issues
(Check 9, 10 results with file:line and suggested fixes)

## Documentation Gaps
(Check 11 results — what's missing or inaccurate)

## Code Duplication
(Check 12 results — duplicated code locations and where it should live)

## Recommendations
(Suggested fixes for each violation, grouped by priority)
```

### Step 4: Output summary to user

Print ONLY a concise summary to the user — not the full report. The summary should include:

1. Overall pass/fail/warn counts
2. One-line per FAIL item (file and what's wrong — no fix details)
3. A pointer to the full report file

Example output:

```
Architecture audit complete. Full report: docs/audits/architecture-audit-2026-03-14.md

12 checks run | 9 passed | 2 failed | 1 warning

FAIL: Check 1 — src/core/agents/agent.ts imports ClaudeCodeLib directly
FAIL: Check 4 — src/core/services/pipeline-engine.ts uses raw SQL (.prepare)
WARN: Check 7 — src/renderer/pages/TaskPage.tsx imports type from src/core/

See the full report for details and suggested fixes.
```

### Step 5: Offer to fix

After showing the summary, ask the user if they want to fix any of the violations. If yes, read the relevant section from the saved report and fix issues one by one, preserving existing behavior.

## Important Notes

- Registration points (files allowed to import concrete implementations) must be: (a) documented in `docs/abstractions.md`, (b) verified to contain pure wiring/registration with no business logic (Check 9), and (c) actually listed in the docs (Check 10). Do not pre-approve any file — verify everything.
- Test files (`*.test.ts`, `*.spec.ts`, `test-*.ts`) are allowed to import concrete implementations for unit testing. Do NOT flag imports in test files.
- `docs/abstractions.md` is the source of truth. If something exists in code but not in the docs, flag it. If something is in the docs but doesn't match the code, flag it.
- Focus on **real leaks that break the abstraction's purpose**, not on pedantic style issues.
