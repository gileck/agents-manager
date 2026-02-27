# Architecture Review: WorkflowService (Orchestration)

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** WorkflowService + PipelineInspectionService
**Previous Score: 8.3 / 10**
**Updated Score: 9.0 / 10**

## Round 2 Changes Implemented

1. **Magic constant named** -- The inline `30000` in stuck-detection logic is now `AGENT_FINALIZATION_GRACE_MS = 30_000` with a JSDoc comment explaining its purpose. Defined in `pipeline-inspection-service.ts` (line 18).

2. **`advancePhase` collapsed to single search** -- The dual-search structure (primary + fallback) is replaced with a single `pipeline.transitions.find()` that filters on `task.status`, `system` trigger, and `advance_phase` hook presence. The activity-log gap is closed: `activityLog.log` is now called on the success path (lines 205-212).

3. **`PipelineInspectionService` extracted** -- Three methods (`getPipelineDiagnostics`, `retryHook`, `advancePhase`) moved out of WorkflowService into a new `PipelineInspectionService` class:
   - **New file:** `src/main/services/pipeline-inspection-service.ts` (217 lines)
   - **New interface:** `src/main/interfaces/pipeline-inspection-service.ts` (11 lines)
   - **Barrel export:** Added to `src/main/interfaces/index.ts`
   - **Composition root:** `src/main/providers/setup.ts` instantiates `PipelineInspectionService` with its 6 dependencies and exposes it on `AppServices`
   - **IPC handlers:** `task-handlers.ts` routes `TASK_HOOK_RETRY`, `TASK_PIPELINE_DIAGNOSTICS`, and `TASK_ADVANCE_PHASE` to `services.pipelineInspectionService` instead of `services.workflowService`
   - **IWorkflowService interface:** Cleaned -- the three extracted methods are removed (12 methods remain)
   - **WorkflowService:** Dropped from ~725 lines to 504 lines (30% reduction)

4. **PipelineInspectionService has fewer dependencies** -- Only 6 constructor parameters (taskStore, pipelineEngine, pipelineStore, taskEventLog, activityLog, agentRunStore) versus WorkflowService's 14. This is a clean, read-heavy service with no mutation side-effects beyond activity logging.

## Round 2 Remaining Issues

1. **No dedicated tests for PipelineInspectionService** (Medium) -- The extracted service has no unit or integration tests. The existing `workflow-service-lifecycle.test.ts` does not cover `getPipelineDiagnostics`, `retryHook`, or `advancePhase`, and the test context (`TestContext`) does not expose `pipelineInspectionService`. These three methods should have dedicated test coverage, especially stuck-detection logic and the `advancePhase` single-search path.

2. **Stale documentation references** (Low) -- Two docs files still list the extracted methods as belonging to WorkflowService:
   - `docs/workflow-service.md` (lines 120-159) documents `getPipelineDiagnostics`, `retryHook`, and `advancePhase` as WorkflowService API surface
   - `docs/architecture-overview.md` (line 124) lists them in the `IWorkflowService` row of the interface table
   - Neither file mentions `PipelineInspectionService` or `IPipelineInspectionService`

3. **`advancePhase` fallback path removed but docs not updated** (Low) -- `docs/workflow-service.md` still describes "Two code paths" (primary + fallback) for `advancePhase`, but the implementation now has a single search. The docs description is stale relative to the actual code.

4. **`retryHook` still has a two-pass search** (Low) -- `retryHook` performs an exact-match search (lines 141-146) followed by a fallback any-transition search (lines 148-151). This is reasonable for robustness but worth noting as a minor complexity point. Not a bug.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 7 | 9 | 504 lines, 12 public methods; inspection logic cleanly separated into dedicated service |
| Low Coupling | 8 | 9 | WorkflowService: 14 deps (all interface-typed); PipelineInspectionService: 6 deps |
| High Cohesion | 7 | 9 | WorkflowService is pure orchestration (CRUD + transitions + agents); inspection is its own service |
| Clear and Constrained State | 8 | 8 | No mutable instance state in either service |
| Deterministic Behavior | 8 | 8 | `getDashboardStats` clock injectable; no new non-determinism introduced |
| Explicit Dependency Structure | 9 | 9 | All deps required, factory pattern documented, new service wired in composition root |
| Observability | 8 | 9 | Activity-log gap in `advancePhase` closed; all mutation paths now log |
| Robust Error Handling | 9 | 9 | All methods return typed results; no unhandled throws |
| Simplicity of Structure | 7 | 9 | `advancePhase` single search; WorkflowService methods are uniformly structured |
| Performance Predictability | 9 | 9 | Parallel queries preserved in extracted service |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 -- Clean separation of concerns; single-search `advancePhase` is correct |
| **Bugs** | 9/10 -- Activity-log gap fixed; no known bugs in either service |
| **Docs** | 8/10 -- Stale docs for extracted methods (workflow-service.md, architecture-overview.md) |
| **Code Quality** | 9/10 -- 30% line reduction; clean interface; proper barrel exports |

**Overall: 9.0 / 10** (up from 8.3)

The remaining gap to a higher score is primarily the lack of dedicated tests for `PipelineInspectionService` and the stale documentation. The code itself is clean, well-structured, and correctly wired.
