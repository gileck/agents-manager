# Implementation Plan: UI Layer Architecture Review Fixes

**Goal:** Bring the UI Layer score from 7.2/10 closer to 9/10
**Priority order:** logic > docs > bugs > tests > code quality
**Source review:** `docs/architecture-review/01-ui-layer.md`

---

## Item 1 (P1 -- Documentation): Update `docs/ipc-and-renderer.md`

**Files to modify:**
- `docs/ipc-and-renderer.md`

**Complexity:** Medium

**Changes needed:**

1. Change channel count from "57+" to "85+" in frontmatter and body.

2. Add 9 missing channel groups to the Channel Inventory section:
   - **Chat (8):** `chat:send`, `chat:stop`, `chat:messages`, `chat:clear`, `chat:summarize`, `chat:output` (push), `chat:message` (push), `chat:costs`
   - **Chat Sessions (5):** `chat:session:create`, `chat:session:list`, `chat:session:update`, `chat:session:delete`, `chat:agents:list`
   - **Kanban (6):** `kanban-board:get`, `kanban-board:get-by-project`, `kanban-board:list`, `kanban-board:create`, `kanban-board:update`, `kanban-board:delete`
   - **Agent Lib (2):** `agent-lib:list`, `agent-lib:list-models`
   - **Shell (3):** `shell:open-in-chrome`, `shell:open-in-iterm`, `shell:open-in-vscode`
   - **Telegram (5):** `telegram:test`, `telegram:bot-start`, `telegram:bot-stop`, `telegram:bot-status`, `telegram:bot-log` (push)
   - **Source Control (3):** `git:project-log`, `git:branch`, `git:commit-detail`
   - **Pipeline Diagnostics (7):** `task:all-transitions`, `task:force-transition`, `task:guard-check`, `task:hook-retry`, `task:pipeline-diagnostics`, `task:advance-phase`, `task:workflow-review`
   - **Additional Agent channels:** `agent:all-runs`, `agent:message` (push), `agent:status` (push), `agent:send-message`

3. Push event listeners: Update from 2 to 8. Add: `AGENT_MESSAGE`, `AGENT_STATUS`, `CHAT_OUTPUT`, `CHAT_MESSAGE`, `TELEGRAM_BOT_LOG`, `NAVIGATE`.

4. Pages table: Add 7 missing pages (ChatPage, TelegramPage, CostPage, SourceControlPage, KanbanBoardPage, ThemePage, ProjectConfigPage). Remove orphaned HomePage.

5. Hooks section: Add 15 missing hooks (useChat, useChatSessions, useActiveAgents, useKanbanBoard, useKanbanDragDrop, useKanbanKeyboardShortcuts, useKanbanMultiSelect, useVirtualizedKanban, useGitLog, useHookRetry, usePipelineDiagnostics, usePipelineStatusMeta, useLocalStorage, useRouteRestore, useThemeConfig).

6. Sidebar nav items: Change from 7 to 12.

**Dependencies:** None.

---

## Item 2 (P1 -- Documentation): Update `docs/cli-reference.md`

**Files to modify:**
- `docs/cli-reference.md`

**Complexity:** Small

**Changes needed:**

1. Add `telegram` command group (start, status).
2. Fix DB close description: change `process.on('exit')` to `.finally()` pattern.
3. Add note about subtask commands bypassing WorkflowService (direct `taskStore.updateTask()` calls).

**Dependencies:** None.

---

## Item 3 (P2 -- Code Quality): Fix `AGENT_SEND_MESSAGE` handler

**Files to modify:**
- `src/main/ipc-handlers.ts` (lines 321-340)

**Complexity:** Small

**Fix:** Move `queueMessage()` before the `if` statement, remove from both branches. The conditional should only handle the `else` case (starting a new agent when none is running).

**Dependencies:** None.

---

## Item 4 (P2 -- Code Quality): Expose `agentLib` in preload `chatSession.create`

**Files to modify:**
- `src/preload/index.ts` (line 411)

**Complexity:** Small

**Fix:** Add optional `agentLib?: string` parameter to the `create` function signature, pass it through to the IPC invoke call.

**Dependencies:** None.

---

## Item 5 (P2 -- Code Quality): Add `--all` flag to CLI `agent runs`

**Files to modify:**
- `src/cli/commands/agent.ts` (lines 39-64)

**Complexity:** Small

**Fix:** Add `.option('--all', 'Show all runs (including completed)')` and route to `agentRunStore.getAllRuns()`. Update `docs/cli-reference.md` to document the flag.

**Dependencies:** Item 2 (coordinate docs update).

---

## Item 6 (P3 -- Structural): Add build-time preload channel sync assertion

**Files to create:**
- `tests/unit/ipc-channel-sync.test.ts`

**Complexity:** Small-Medium

**Approach:** Create a Vitest unit test that:
1. Imports `IPC_CHANNELS` from `src/shared/ipc-channels.ts`
2. Reads raw source of `src/preload/index.ts`
3. Asserts every channel string from the shared file appears in the preload source
4. Asserts key counts match

**Dependencies:** None.

---

## Item 7 (P3 -- Structural): Split `ipc-handlers.ts` into domain-scoped files

**Files to modify:**
- Refactor `src/main/ipc-handlers.ts` → `src/main/ipc-handlers/` directory
- ~20 domain-scoped handler files + barrel `index.ts` + `helpers.ts`

**Complexity:** Large (mechanical but high file count)

**Approach:** Each file exports `registerXxxHandlers(services: AppServices)`. Barrel `index.ts` calls all registrars. Preserves public API.

**Dependencies:** Do after Items 3 and 4 to avoid merge conflicts.

---

## Quick Wins (P4-P5)

### Item 9: Remove orphaned `HomePage.tsx`
- Delete `src/renderer/pages/HomePage.tsx`
- Verify no imports exist first
- **Complexity:** Small

### Item 10: Surface polling errors in `useActiveAgentRuns`
- Add `error` state to the hook, surface instead of silently swallowing
- **Complexity:** Small

---

## Implementation Sequence

| Phase | Items | Rationale |
|-------|-------|-----------|
| 1 | 3, 4, 5, 10 | Small code fixes. No dependencies. Parallel. |
| 2 | 9 | Quick cleanup (delete orphaned file). |
| 3 | 6 | Add channel sync test. |
| 4 | 1, 2 | Documentation updates (reference final code state). |
| 5 | 7 | Large structural refactor (separate PR). |

---

## Expected Score Impact

| Dimension | Current | After | Notes |
|-----------|---------|-------|-------|
| Modularity | 8 | 9 | Split ipc-handlers.ts |
| Explicit Dependency Structure | 7 | 8.5 | Channel sync test |
| Observability | 7 | 7.5 | Error surfacing in polling |
| Simplicity of Structure | 7 | 8 | Domain-scoped handlers |
| Documentation alignment | -- | +1 | Comprehensive doc update |

**Estimated overall score after all fixes: 8.5-9.0/10**
