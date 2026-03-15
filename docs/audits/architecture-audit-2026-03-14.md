# Architecture Audit Report — 2026-03-14

## Summary
- Scopes checked: abstractions, layers, registration, docs
- Total checks run: 12
- Passed: 6
- Failed: 5
- Warnings: 3

## Fixes Applied (2026-03-15)
- **Check 1 / Check 10** (git.ts): Removed direct `LocalGitOps`/`GitHubScmPlatform` imports. Added `createScmPlatform` factory to `AppServices`. Route now uses `services.createGitOps()` and `services.createScmPlatform()`.
- **Check 1 / Check 10** (daemon/index.ts): Moved `InAppNotificationRouter` wiring into `setup.ts` via `onInAppNotification` callback in `AppServicesConfig`. `daemon/index.ts` no longer imports any concrete implementation.
- **Check 9 / Check 10** (telegram.ts): Extracted `TelegramBotManager` service (`src/core/services/telegram-bot-manager.ts`). All bot lifecycle logic moved there. Route file reduced to thin REST wrappers over `services.telegramBotManager`. Wired in `setup.ts` via `telegramBotManagerCallbacks`.
- **Check 11** (docs): Added `IItemStore`/`sqlite-item-store.ts` and `ITimelineStore`/`sqlite-timeline-store.ts` to Section 5 store table. Added `TriageAgentPromptBuilder` as implementation in Section 17.
- **Check 12** (image handling): Extracted `mediaTypeToExtension`, `normalizeBase64`, and `writeImagesToTempDir` to `src/core/libs/image-utils.ts`. Removed ~30 lines of duplicated code from `codex-cli-lib.ts` and `codex-app-server-lib.ts`.

**Remaining open issues:**
- **Check 5** (`chat-agent-service.ts` SDK types) — requires adding a `query()` method to `IAgentLib` and defining engine-agnostic message types; deferred due to higher risk.

---

## Abstraction Integrity

### Check 1: No Direct Implementation Imports — FAIL

Three non-test, non-documented-registration-point files import concrete implementations directly:

**src/daemon/routes/git.ts**
- Line 2: `import { LocalGitOps } from '../../core/services/local-git-ops';`
- Line 3: `import { GitHubScmPlatform } from '../../core/services/github-scm-platform';`
- Fix: Remove direct imports; obtain instances via `services.createGitOps(path)` and `services.createScmPlatform(path)` factories already present on `AppServices`.

**src/daemon/routes/telegram.ts**
- Line 4: `import { TelegramNotificationRouter } from '../../core/services/telegram-notification-router';`
- Fix: Move bot lifecycle logic (start/stop/configure) into a dedicated `TelegramBotManager` service. Route handler should call `services.telegramBotManager.startForProject(projectId)`.

**src/daemon/index.ts**
- Line 8: `import { InAppNotificationRouter } from '../core/services/in-app-notification-router';`
- Fix: Wire `InAppNotificationRouter` inside `setup.ts` and add the router to `MultiChannelNotificationRouter` there. `daemon/index.ts` should not need to know about this implementation.

### Check 2: Constructor Parameter Types Use Interfaces — PASS

All major services declare interface-typed constructor parameters:
- `WorkflowService`: ITaskStore, IProjectStore, IPipelineEngine, IPipelineStore, ITaskEventLog, IActivityLog, IAgentRunStore, IPendingPromptStore, ITaskArtifactStore, IAgentService, IScmPlatform factory, IWorktreeManager factory, IGitOps factory, ITaskContextStore, IDevServerManager — all interfaces.
- `AgentService`: IAgentFramework, IAgentRunStore, IWorktreeManager factory, ITaskStore, IProjectStore, ITaskEventLog, ITaskPhaseStore, IPendingPromptStore, IGitOps factory, ITaskContextStore, IAgentDefinitionStore, INotificationRouter — all interfaces.
- `PipelineEngine`: IPipelineStore, ITaskStore, ITaskEventLog, ITransactionRunner, IGuardQueryContext — all interfaces.
- `TimelineService`: ITimelineSource[] — interface array.

### Check 5: No Engine-Specific Code in Agents or Prompt Builders — FAIL

**src/core/services/chat-agent-service.ts, line 17**
```
import { SDKMessage, SDKAssistantMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
```
These SDK types are used throughout the service (lines 35, 1576, 1584, 1598, 1600, 1601, 1620, 1625).

- **Impact**: `chat-agent-service.ts` is bound to the Claude SDK. If a different engine were used for chat, this service would need to change — violating the purpose of the AgentLib abstraction.
- **Fix**: Define engine-agnostic message types in `src/shared/types.ts` or `src/core/interfaces/agent-lib.ts` and map to/from SDK types only inside `claude-code-lib.ts`.

All files in `src/core/agents/` are clean — no engine-specific imports in any prompt builder or Agent class.

### Check 8: Interface Completeness — PASS

All 19+ interfaces in `src/core/interfaces/` have at least one implementation:
- AgentLib: 5 implementations (claude-code-lib, cursor-agent-lib, codex-cli-lib, codex-app-server-lib + base)
- IAgent: 2 implementations (agent.ts, scripted-agent.ts)
- All 20 store interfaces: matching sqlite-*.ts implementations
- IWorkflowService, IAgentService, IPipelineEngine, IPipelineInspectionService, IGitOps, IScmPlatform, IWorktreeManager, INotificationRouter, ISessionHistoryProvider, IDevServerManager, ITelegramBotService, IAutomatedAgentPromptBuilder, ITimelineSource — all have implementations.

### Check 12: Code Duplication — FAIL (2 items) + WARN (2 items)

**FAIL: Timeline sources — 8 identical thin adapters**

All 8 files in `src/core/services/timeline/sources/` are structurally identical:
```typescript
export class XyzSource implements ITimelineSource {
  constructor(private store: ITimelineStore) {}
  getEntries(taskId: string): DebugTimelineEntry[] {
    return this.store.getXyzEntries(taskId);
  }
}
```
Each is only 12 lines and delegates to a single `ITimelineStore` method. This is ~96 lines of boilerplate for no abstraction gain.
- **Fix**: Replace with inline lambdas registered in `TimelineService`. E.g.:
  ```typescript
  const sources: ITimelineSource[] = [
    { getEntries: (id) => store.getActivityEntries(id) },
    { getEntries: (id) => store.getAgentRunEntries(id) },
    // ...
  ];
  ```

**FAIL: Image handling duplicated across 3 AgentLib implementations**

Near-identical image-to-file conversion logic exists in:
- `src/core/libs/claude-code-lib.ts` (lines 145–162, inline in `runEngine`)
- `src/core/libs/codex-cli-lib.ts` (lines 502–525, `buildSdkInput()`)
- `src/core/libs/codex-app-server-lib.ts` (lines 779–808, `buildTurnInput()`)

All three: check for images, create a temp dir with `mkdtemp`, convert base64 to file, build input with text + image files.
- **Fix**: Extract to `src/core/libs/shared-image-builder.ts` with a `buildImagesInput(images, prompt)` function. Each lib calls this shared utility.

**WARN: Store CRUD error-wrapping boilerplate**

Every method in every store wraps DB calls in `try { ... } catch (err) { getAppLogger().logError(...); throw err; }`. Consistent but verbose.
- Not recommended to abstract — the explicitness documents the pattern and error context is valuable per-call.

**WARN: SDK hook error-wrapping in claude-code-lib.ts**

`buildSdkHooks()` (lines 470–656) repeats the same try/catch wrapper across 9 hook handlers (PreToolUse, PostToolUse, PostToolUseFailure, Notification, Stop, SubagentStart, SubagentStop, PreCompact, etc.).
- Acceptable as the repetition documents the SDK hook contract clearly.

---

## Layer Boundary Violations

### Check 3: No Business Logic in Transport/Client Layers — PASS

All IPC handlers (18 files in `src/main/ipc-handlers/`), all CLI commands (`src/cli/`), and daemon routes (`src/daemon/routes/`) are thin wrappers:
- Extract parameters → call one service/API method → return result.
- No DB queries, no complex conditionals, no multi-step orchestration in any of these files.

### Check 4: No SQLite/DB Imports Outside Stores and Setup — PASS

All `better-sqlite3` imports, `.prepare()` calls, and raw SQL strings are confined to:
- `src/core/stores/` — all store implementations
- `src/core/db.ts` — DB initialization
- `src/core/schema.ts` — baseline schema
- `src/core/migrations.ts` — incremental migrations

No violations.

### Check 6: No Platform-Specific Code in Services — PASS

Grepped all `src/core/services/` files (excluding `local-git-ops.ts`, `github-scm-platform.ts`, `local-worktree-manager.ts`) for `execSync`, `spawn`, `child_process`, `'git `, `'gh `.
- `dev-server-manager.ts` uses `spawn` to start dev servers — acceptable; this is its purpose.
- `validation-runner.ts` uses `exec` for running validation commands (e.g., `yarn checks`) — not git/gh.
- All other matches are false positives (log messages, variable names, comments).
- No service bypasses IGitOps or IScmPlatform with raw git/gh commands.

### Check 7: Renderer Does Not Import Core — PASS

Zero imports from `src/core/` found in any `src/renderer/` file. All business logic is accessed via `window.api` IPC bridge.

---

## Registration Point Issues

### Check 9: Registration Points Are Pure Wiring — FAIL

**src/daemon/routes/telegram.ts** (`startBotForProject`, lines 32–73) mixes business logic with instantiation:
- Line 37: `services.projectStore.getProject(projectId)` — data query
- Lines 40–45: Runtime validation (reading config, validating Telegram credentials)
- Lines 47–57: Service instantiation using runtime-dependent data
- Lines 59–72: Multiple side effects (callbacks, starting bot, tracking map, WebSocket broadcast)
- **Fix**: Extract to a `TelegramBotManager` service in `src/core/services/`. Route handler calls one method.

**src/daemon/routes/git.ts** (line 20) instantiates `LocalGitOps` directly:
```typescript
return new LocalGitOps(worktree.path);  // should be services.createGitOps(worktree.path)
```
- **Fix**: Replace `new LocalGitOps(...)` with `services.createGitOps(worktree.path)`.

The documented registration points are clean:
- `src/core/providers/setup.ts` — pure instantiation and wiring only. ✓
- `src/core/services/agent-lib-registry.ts` — pure registration container. ✓

### Check 10: Undocumented Registration Points — FAIL

Files importing concrete implementations that are NOT documented in `docs/abstractions.md` as registration points:

| File | Concrete Imports | Status |
|------|-----------------|--------|
| `src/daemon/routes/git.ts` | `LocalGitOps`, `GitHubScmPlatform` | Undocumented leak |
| `src/daemon/routes/telegram.ts` | `TelegramNotificationRouter`, `TelegramAgentBotService` | Undocumented leak |
| `src/daemon/index.ts` | `InAppNotificationRouter` | Undocumented; registration logic outside setup.ts |

These files are not legitimate registration points (they contain business logic — see Check 9). The correct fix is to eliminate these direct imports by moving the logic into services and wiring in `setup.ts`.

---

## Documentation Gaps

### Check 11: Documentation Completeness and Accuracy — WARN (3 items)

**Missing from Section 5 (Data Stores) table:**

1. `IItemStore` → `sqlite-item-store.ts`
   - Implemented and wired in `setup.ts` but not listed in the store table in `docs/abstractions.md`.

2. `ITimelineStore` → `sqlite-timeline-store.ts`
   - Implemented and wired in `setup.ts`. `ITimelineSource` is documented in Section 19, but the underlying `ITimelineStore` is entirely absent from the docs.

**Missing from Section 17 (AutomatedAgentPromptBuilder):**

3. `TriageAgentPromptBuilder` (`src/core/services/triage-agent-prompt-builder.ts`) implements `IAutomatedAgentPromptBuilder` but is not mentioned in Section 17.
   - Section 17 documents only the interface, with no implementations listed.

All other file paths mentioned in `docs/abstractions.md` were verified to exist and match their described purpose.

---

## Recommendations (by priority)

### High (Fix Now)

1. **Check 1 / Check 10**: Remove direct concrete imports from route handlers.
   - `src/daemon/routes/git.ts`: use `services.createGitOps()` and `services.createScmPlatform()` factories instead of `new LocalGitOps()`/`new GitHubScmPlatform()`.
   - `src/daemon/routes/telegram.ts`: move bot lifecycle logic into a dedicated `TelegramBotManager` service; wire it in `setup.ts`.
   - `src/daemon/index.ts`: move `InAppNotificationRouter` construction into `setup.ts`.

2. **Check 5**: Remove Claude SDK type imports from `chat-agent-service.ts`.
   - Define engine-agnostic message types in `src/shared/` or `src/core/interfaces/agent-lib.ts`.
   - Map to/from SDK types only inside `src/core/libs/claude-code-lib.ts`.

### Medium (Address Soon)

3. **Check 12 (Timeline Sources)**: Replace 8 identical thin adapter files with inline lambdas in `TimelineService`.

4. **Check 12 (Image Handling)**: Extract shared image-to-file utility to `src/core/libs/shared-image-builder.ts`.

### Low (Documentation)

5. **Check 11**: Update `docs/abstractions.md` Section 5 to add `IItemStore` and `ITimelineStore`. Update Section 17 to list `TriageAgentPromptBuilder` as the known implementation.
