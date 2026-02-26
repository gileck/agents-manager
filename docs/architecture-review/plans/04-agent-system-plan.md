# Plan 04: Agent System (8.5 → 9+)

## Gap Analysis

- **`runAgentInBackground` is ~400 lines** — Mixes subtask sync, output buffering, and post-run extraction in one method
- **`ChatAgentService` has duplicate SDK loops** — `runViaDirectSdk()` and `summarizeMessages()` share identical SDK interaction patterns
- **Hand-rolled SDK type definitions** — Lines 13-33 of `chat-agent-service.ts` duplicate SDK types
- **`isReadOnlyMode` guard lacks documentation** — Non-obvious why `technical_design*` modes are excluded
- **Validation retry token attribution assumption** — `latestRunId` assumed to map to correct retry run; no verification

## Changes

### 1. Extract `SubtaskSyncInterceptor`

**Files:** `src/main/services/subtask-sync-interceptor.ts` (new), `src/main/services/agent-service.ts`

New class taking `taskStore` + `task` in constructor. Moves:
- `wrappedOnMessage` logic
- `mapSdkStatus` helper
- `persistSubtaskChanges` method

~100 lines extracted from `runAgentInBackground`.

### 2. Extract `AgentOutputFlusher`

**Files:** `src/main/services/agent-output-flusher.ts` (new), `src/main/services/agent-service.ts`

New class owning:
- `outputBuffer`, `messagesBuffer`, `flushInterval`
- Methods: `start()`, `stop()`, `getBufferedOutput()`, `getBufferedMessages()`

~50 lines extracted.

### 3. Extract `PostRunExtractor`

**Files:** `src/main/services/post-run-extractor.ts` (new), `src/main/services/agent-service.ts`

New module handling:
- Plan extraction
- Tech design extraction
- Context entry saving

~130 lines extracted from `runAgentInBackground`.

### 4. Consolidate `ChatAgentService` SDK loops

**File:** `src/main/services/chat-agent-service.ts`

- Extract private `runSdkQuery()` helper used by both `runViaDirectSdk()` and `summarizeMessages()`
- Remove hand-rolled SDK type definitions (lines 13-33), import from SDK package directly

### 5. Add `isReadOnlyMode` JSDoc

**File:** `src/main/services/agent-service.ts`

Add explicit JSDoc explaining why `technical_design*` modes are excluded from the read-only guard.

### 6. Add validation retry run-ID guard

**File:** `src/main/services/agent-service.ts`

In the validation retry path, verify that `latestRunId` actually corresponds to a run for the current task before reusing it. Add an explicit check (e.g., `agentRunStore.get(latestRunId)` and compare `taskId`) with a descriptive error if mismatched. This prevents silent misattribution of retry tokens to the wrong run.

## Files to Modify

| File | Action |
|------|--------|
| `src/main/services/agent-service.ts` | Edit (extract 3 modules, add JSDoc) |
| `src/main/services/subtask-sync-interceptor.ts` | Create |
| `src/main/services/agent-output-flusher.ts` | Create |
| `src/main/services/post-run-extractor.ts` | Create |
| `src/main/services/chat-agent-service.ts` | Edit (consolidate SDK loops) |

## Complexity

Large (~6 hours)
