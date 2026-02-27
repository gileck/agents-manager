# Architecture Review: Error Flows Handling

**Date:** 2026-02-27
**Component:** Error Flow Handling (Cross-Cutting)
**Score: 7.1 / 10**

## Summary

The codebase shows strong error handling in core business paths -- agent execution, pipeline transitions, and store operations are well protected with structured logging to the task event log. The agent execution path has a mature two-level try/catch pattern with outer FATAL guard and `finally` cleanup. The main weaknesses are concentrated in the IPC layer (no consistent error contract) and several "best-effort" silent swallows that go completely unlogged. The `start_agent` hook returning success unconditionally is the highest-risk pattern.

## Strengths

- **Two-level try/catch in `runAgentInBackground`** -- Inner catch for agent crashes (with partial telemetry recovery), outer catch for post-processing FATAL errors, `finally` for cleanup. Well-hardened.
- **Pipeline engine rollback** -- `required` hooks that fail trigger proper rollback with guard audit trail.
- **`MultiChannelNotificationRouter` uses `Promise.allSettled`** -- One failing channel never affects others.
- **`parseJson` utility** -- Centralizes JSON parse error handling across all stores.
- **Store error pattern** -- Consistent `try/catch` + `console.error` + re-throw with method context.
- **Global uncaught exception handlers** -- `template/main/core/app.ts` catches `uncaughtException` and `unhandledRejection`.

## Issues Found

### Critical

1. **IPC handlers have no error boundary or consistent error format** -- `template/main/ipc/ipc-registry.ts:8-13`: `ipcMain.handle` wraps handlers with no per-handler error boundary. Some handlers return `{ success: false, error }`, others throw, others return `null` silently. The renderer has no standard way to distinguish "not found" from "operation failed".

### High

2. **`start_agent` hook returns `{ success: true }` unconditionally** -- `src/main/handlers/agent-handler.ts:24-41`: `workflowService.startAgent()` is fire-and-forget. The hook always reports success regardless of whether the agent launches. Pipeline completes the transition, but the task may be stuck with no running agent. Invisible failure.

3. **Queue message processing silently swallows all errors** -- `src/main/services/agent-service.ts:572-577`: Empty `catch {}` with no logging. If `execute()` throws for a queued follow-up message, the message disappears without any indication to the user.

4. **`outcomeResolver.resolveAndTransition` errors leave task in broken state** -- If it throws mid-transition (e.g. DB failure), the outer FATAL catch marks the run as failed but the task status may be in an intermediate state. No compensating rollback possible.

5. **Git IPC read handlers silently return `null` on any error** -- `src/main/ipc-handlers/git-handlers.ts:31-50`: Six handlers (`GIT_DIFF`, `GIT_STAT`, `GIT_WORKING_DIFF`, `GIT_STATUS`, `GIT_LOG`, `GIT_SHOW`) swallow all errors with no logging. User sees blank diff pane with no explanation.

### Medium

6. **`parseJson` silently returns fallback on corrupt data** -- `src/main/stores/utils.ts:11-18`: Used for ~12 columns (subtasks, phases, tags, metadata, messages). Corrupt JSON produces silent empty arrays. No warning log, no event, extremely hard to diagnose.

7. **`WorkflowService.cleanupWorktree` swallows ALL errors** -- `src/main/services/workflow-service.ts:480-503`: Outer `catch {}` swallows DB failures, lock errors, everything. No logging. Worktree leaks are invisible.

8. **`MultiChannelNotificationRouter` logs failures to `console.error` only** -- `src/main/services/multi-channel-notification-router.ts:22-32`: No structured event log entry. Notification delivery failures invisible in the timeline/event UI.

9. **`isPRMergeable` uses bare `JSON.parse` without try/catch** -- `src/main/services/github-scm-platform.ts:66-67`: If `gh` CLI outputs non-JSON (auth error, rate limit), `SyntaxError` propagates with no context about which PR was being checked.

10. **`AgentSupervisor.poll()` errors only go to `console.error`** -- `src/main/services/agent-supervisor.ts:24`: No structured event log, no counter for consecutive failures, no alerting if supervisor repeatedly fails.

11. **Outcome transition failures don't surface to UI** -- `src/main/services/outcome-resolver.ts:202-209`: When a pipeline transition fails after a successful agent run, it's logged as a warning but no exception is re-thrown, no `onStatusChange` callback fired. Task left in limbo.

### Low

12. **`SubtaskSyncInterceptor.handleMessage` relies on outer try/catch for JSON.parse safety** -- `src/main/services/subtask-sync-interceptor.ts:46`: Inner methods have no individual try/catch. Fragile if outer wrapper is refactored.

13. **`recoverOrphanedRuns` worktree-unlock catch swallows DB failures** -- `src/main/services/agent-service.ts:87-98`: Comment says "worktree may not exist" but catch also swallows task/project DB lookup failures. No logging.

14. **CLI commands inconsistently set `process.exitCode`** -- `src/cli/index.ts:59-62`: Top-level catch sets `exitCode = 1`, but commands that handle their own errors may return without setting it, falsely indicating success to shell scripts.

### Info

15. **`onLog` callback uses fire-and-forget for every debug event log** -- `src/main/services/agent-service.ts:353-361`: `.catch(() => {})` swallows even unexpected DB errors. A suppressed-error counter would help diagnose DB degradation during long runs.

## Quality Ratings

| Area | Score | Notes |
|------|:-----:|-------|
| Agent execution error flows | 8 | Two-level try/catch, FATAL guard, partial telemetry recovery. Deducted for silent queue-message swallow and outcome-transition limbo |
| Pipeline engine error flows | 9 | Guard audit trail, hook policy enforcement, transactional rollback |
| WorkflowService error flows | 7 | Consistent throw-or-return. Deducted for silent `cleanupWorktree` |
| IPC handler error flows | 4 | No per-handler error boundary, no consistent format, 6 read handlers silently return null |
| Store-level error handling | 8 | Consistent try/catch + log + re-throw. `parseJson` silent fallback is double-edged |
| Git/SCM error flows | 7 | Good pre-agent rebase wrappers. Silent null returns in IPC layer hurt. Unguarded JSON.parse |
| Notification error flows | 7 | `Promise.allSettled` is correct. Failures only reach console.error |
| CLI error flows | 6 | Top-level catch works. Inner commands inconsistent with exitCode |
| Error context enrichment | 7 | taskId/agentRunId consistently included. Git errors lack branch context |
| Silent failure patterns | 6 | Several genuine silent swallows: start_agent hook, queue processing, cleanupWorktree, git IPC reads |

| Category | Score |
|----------|:-----:|
| **Logic** | 7.5/10 -- Core paths well-protected; edge cases have gaps |
| **Bugs** | 7/10 -- `start_agent` unconditional success is highest-risk; no data loss bugs |
| **Docs** | 6/10 -- Error handling patterns not documented; must be learned by reading code |
| **Code Quality** | 7.5/10 -- Good patterns in core, inconsistent in periphery (IPC, CLI, stubs) |

**Overall: 7.1 / 10**

Addressing issues 1-5 would raise the score to approximately 8.5/10.
