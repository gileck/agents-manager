# Plan 02: WorkflowService (8.3 → 9+)

## Gap Analysis

- **Magic constant `30000`** — Inline timeout with no documentation of purpose
- **`advancePhase` has redundant dual search** — Search 1 + fallback Search 2 can be collapsed into a single `find()`
- **WorkflowService at 725 lines** — Diagnostic/inspection methods inflate the class beyond its orchestration role

## Changes

### 1. Name the magic constant

**File:** `src/main/services/workflow-service.ts`

Add at module top:
```ts
const AGENT_FINALIZATION_GRACE_MS = 30_000;
```
Replace the inline `30000` usage with this constant.

### 2. Collapse `advancePhase` to single search

**File:** `src/main/services/workflow-service.ts`

Replace the dual-search logic in `advancePhase` with a single `pipeline.transitions.find(...)` that filters on:
- `task.status` matches `from`
- `system` trigger
- `advance_phase` hook presence

Ensure `activityLog.log` is called on the success path.

### 3. Extract `PipelineInspectionService`

**Files:** `src/main/services/pipeline-inspection-service.ts` (new), `src/main/services/workflow-service.ts`, `src/main/providers/setup.ts`

Move these methods out of WorkflowService into a new `PipelineInspectionService`:
- `getPipelineDiagnostics`
- `retryHook`
- `advancePhase`

Update `createAppServices` composition root in `src/main/providers/setup.ts` to instantiate `PipelineInspectionService` and expose it on `AppServices`.

WorkflowService delegates to PipelineInspectionService or the methods are accessed directly. Target: WorkflowService drops from ~725 to ~500 lines.

## Files to Modify

| File | Action |
|------|--------|
| `src/main/services/workflow-service.ts` | Edit (extract methods, add constant) |
| `src/main/services/pipeline-inspection-service.ts` | Create |
| `src/main/interfaces/pipeline-inspection-service.ts` | Create (interface) |
| `src/main/providers/setup.ts` | Edit (wire new service) |

## Complexity

Medium (~4 hours)
