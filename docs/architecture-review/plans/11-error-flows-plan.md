# Plan 11: Error Flows Handling Improvements (7.1 → 8.5+)

**Review:** `docs/architecture-review/11-error-flows.md`
**Target issues:** #2-5 (high), #6-9, #11, #13

Note: Issue #1 (IPC error boundary) is in `template/` which is off-limits per CLAUDE.md. Issue #4 (outcome resolver mid-transition) requires transactional DB support beyond current scope.

## 1. Add delayed launch verification to start_agent hook

**File:** `src/main/handlers/agent-handler.ts`

The hook is fire-and-forget by design (can't block the transition). Add a delayed verification to make failures visible:

- After the `workflowService.startAgent()` fire-and-forget call, schedule a 5-second `setTimeout`
- In the callback, check if an active run exists for the task via `agentRunStore.getActiveRunsForTask(task.id)`
- If no run found, log a high-severity event: "Agent failed to start within 5s"
- Update `AgentHandlerDeps` to include `agentRunStore: IAgentRunStore`
- Update registration in `src/main/providers/setup.ts` to pass `agentRunStore`

Addresses: #2 (start_agent returns success unconditionally).

## 2. Add logging to queue message processing catch block

**File:** `src/main/services/agent-service.ts` (~line 576)

Replace:
```ts
} catch { /* queue processing failure is non-fatal */ }
```
With:
```ts
} catch (queueErr) {
  const queueMsg = queueErr instanceof Error ? queueErr.message : String(queueErr);
  this.taskEventLog.log({
    taskId,
    category: 'agent',
    severity: 'warning',
    message: `Queue follow-up message processing failed: ${queueMsg}`,
    data: { agentRunId: run.id },
  }).catch(() => {});
}
```

Addresses: #3 (silent queue message swallow).

## 3. Add console.error to git IPC read handlers

**File:** `src/main/ipc-handlers/git-handlers.ts`

For all 6 read handlers (`GIT_DIFF`, `GIT_STAT`, `GIT_WORKING_DIFF`, `GIT_STATUS`, `GIT_LOG`, `GIT_SHOW`), replace:
```ts
} catch {
  return null;
}
```
With:
```ts
} catch (err) {
  console.error(`[git-handlers] ${CHANNEL_NAME} failed for task ${taskId}:`, err);
  return null;
}
```

Addresses: #5 (6 handlers silently return null).

## 4. Add console.warn to parseJson on corrupt data

**File:** `src/main/stores/utils.ts`

Replace:
```ts
} catch {
  return fallback;
}
```
With:
```ts
} catch (err) {
  console.warn('[parseJson] Corrupt JSON, returning fallback:', err instanceof Error ? err.message : String(err));
  return fallback;
}
```

Addresses: #6 (silent fallback on corrupt data).

## 5. Add logging to WorkflowService.cleanupWorktree

**File:** `src/main/services/workflow-service.ts` (~line 500)

Replace outer catch:
```ts
} catch {
  // Best-effort cleanup — don't block the operation
}
```
With:
```ts
} catch (err) {
  console.error(`[workflow-service] cleanupWorktree failed for task ${task.id}:`, err);
}
```

Addresses: #7 (swallows ALL errors including DB failures).

## 6. Wrap JSON.parse in isPRMergeable and getPRStatus

**File:** `src/main/services/github-scm-platform.ts`

Wrap bare `JSON.parse(output)` calls at lines 67 and 84:

```ts
let data: Record<string, unknown>;
try {
  data = JSON.parse(output);
} catch {
  throw new Error(`isPRMergeable: Failed to parse gh output for PR #${prNumber}: ${output.slice(0, 200)}`);
}
```

Same pattern for `getPRStatus`.

Addresses: #9 (SyntaxError propagates with no context).

## 7. Re-throw outcome transition failure

**File:** `src/main/services/outcome-resolver.ts` (~line 202)

When `result.success` is false after a transition attempt, the warning is logged but execution continues silently. Add a throw after the warning log so the error propagates to the FATAL guard in `runAgentInBackground`:

```ts
if (!result.success) {
  // ... existing warning log ...
  throw new Error(`Outcome transition "${outcome}" to "${match.to}" failed: ${result.error ?? result.guardFailures?.map(g => g.reason).join(', ')}`);
}
```

Addresses: #11 (task left in limbo after transition failure).

## 8. Add logging to recoverOrphanedRuns worktree-unlock catch

**File:** `src/main/services/agent-service.ts` (~line 96)

Replace:
```ts
} catch {
  // Worktree may not exist — safe to ignore
}
```
With:
```ts
} catch (err) {
  console.warn(`[agent-service] recoverOrphanedRuns: worktree unlock failed for task ${run.taskId}:`, err instanceof Error ? err.message : String(err));
}
```

Addresses: #13 (catch swallows DB failures too).

## Files summary

| File | Action |
|------|--------|
| `src/main/handlers/agent-handler.ts` | Edit — add delayed launch verification |
| `src/main/providers/setup.ts` | Edit — pass agentRunStore to agent handler deps |
| `src/main/services/agent-service.ts` | Edit — log queue catch (line 576), orphan recovery catch (line 96) |
| `src/main/ipc-handlers/git-handlers.ts` | Edit — add console.error to 6 read handler catches |
| `src/main/stores/utils.ts` | Edit — add console.warn to parseJson |
| `src/main/services/workflow-service.ts` | Edit — add console.error to cleanupWorktree |
| `src/main/services/github-scm-platform.ts` | Edit — wrap 2 JSON.parse calls in try/catch |
| `src/main/services/outcome-resolver.ts` | Edit — re-throw on transition failure |

## Verification

1. `yarn checks` — TypeScript + ESLint pass
2. `yarn test` — All existing tests pass (changes are logging additions + error wrapping, not behavioral changes except #7 re-throw)
3. Verify outcome-resolver re-throw doesn't break existing e2e tests (the FATAL guard in runAgentInBackground handles it)
