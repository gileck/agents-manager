# Architecture Review: Agent System

**Date:** 2026-02-27 (Round 3 re-review)
**Component:** Agent System (AI Execution Layer)
**Previous Score: 9.0 / 10**
**Updated Score: 9.3 / 10**

## Round 3 Changes Implemented

1. **`ValidationRunner` extraction** (132 lines) -- Extracted from `AgentService.runAgentInBackground` into `src/main/services/validation-runner.ts`:
   - Validation retry while-loop with cost accumulation across retries
   - Run-ID ownership guard (prevents misattribution if run references become stale)
   - Final validation check after retries exhausted
   - `runValidation()` shell command executor (moved from AgentService private method)
   - `getValidationCommands()` static method -- pure function for mode-based command filtering
   - Fixed misleading `passed` log: now tracks `validationPassed` boolean explicitly instead of using `attempts < maxRetries` as proxy (review finding)

2. **`OutcomeResolver` extraction** (185 lines) -- Extracted from `AgentService.runAgentInBackground` into `src/main/services/outcome-resolver.ts`:
   - `resolveAndTransition()` -- handles the entire post-execution outcome flow
   - `verifyBranchDiff()` -- git diff check, no_changes guard
   - `detectConflicts()` -- rebase check, conflicts_detected outcome
   - `tryOutcomeTransition()` -- pipeline transition dispatch with multi-candidate resolution (moved from AgentService private method)
   - Branch artifact creation and phase completion
   - Worktree unlock with safe error swallowing

3. **`AgentService` further reduced** -- From 949 lines to 673 lines (~29% reduction). `runAgentInBackground` now delegates validation to `ValidationRunner.runWithRetries()` and outcome resolution to `OutcomeResolver.resolveAndTransition()`. Two private methods deleted: `runValidation()` and `tryOutcomeTransition()`. Six unused imports removed (`IPipelineEngine`, `ITaskArtifactStore`, `TransitionContext`, `exec`, `promisify`, `getShellEnv`).

## Round 3 Remaining Issues

1. **`AgentOutputFlusher` uses `agent as unknown as { ... }` casts** (Low) -- Lines 84-89 access agent telemetry fields via unsafe type casts. A small `AgentTelemetry` interface on `IAgent` would make this type-safe, but the current approach works correctly.

2. **`SubtaskSyncInterceptor.handleMessage` silently swallows parse errors** (Info) -- `JSON.parse(msg.input)` failures are caught and logged but the calling code has no way to distinguish a handled tool_use from a malformed one. Acceptable for fire-and-forget sync, but a metrics counter would improve observability.

3. **`ChatAgentService` cleanup timeouts are hard-coded** (Info) -- 5-second `setTimeout` for agent cleanup (lines 202, 456) and 1-hour staleness threshold (line 296) are magic numbers. Named constants would improve readability.

4. **`AgentService.execute()` still ~210 lines** (Info) -- Worktree preparation, environment setup, and context building could be extracted into a dedicated class, but the current structure is readable and each section is well-commented. Not urgent.

## What Was Fixed (Round 2)

1. **`AgentService` god-class decomposition** -- Three extractions: `SubtaskSyncInterceptor` (124 lines), `AgentOutputFlusher` (115 lines), `PostRunExtractor` (240 lines). AgentService reduced from ~1230 to 949 lines.
2. **`ChatAgentService` SDK loop consolidation** -- `runSdkQuery()` helper eliminated duplicated streaming loop.
3. **`isReadOnlyMode` JSDoc added** -- Explains why `technical_design*` modes are excluded.
4. **Validation retry run-ID guard** -- Prevents token misattribution on stale run references.
5. **Hand-rolled SDK types retained (intentional)** -- JSDoc explains the ESM dynamic-import trade-off.

## What Was Fixed (Round 1)

1. **Bug 1: `Agent.isAvailable()` hardcoded `claude-code`** -- Fixed: constructor accepts `defaultEngine`, `isAvailable()` uses it.
2. **Bug 2: `listAgents()` returned `available: false`** -- Fixed: returns optimistic `available: true`; async real check in `getAvailableAgents()`.
3. **Bug 3: Validation retry omitted 4 of 6 callbacks** -- Fixed: all 6 forwarded at `agent-service.ts:518`.
4. **Bug 4: Supervisor timeout < implement timeout** -- Fixed: default raised to 35 min; per-run `timeoutMs + 5 min grace`.
5. **Issue 6: `review` mode not in read-only guard** -- Fixed: `base-agent-prompt-builder.ts:67` includes `'review'`.
6. **Doc gaps: PromptRenderer, ChatAgentService, AgentSupervisor, SandboxGuard undocumented** -- Fixed: all four fully documented.
7. **Test gap: ImplementorPromptBuilder** -- Fixed: 69-test suite covering all 13 modes, phase display, readOnly flag, needs_info, timeout overrides.

## Quality Ratings

| Dimension | Round 1 | Round 2 | Round 3 | Notes |
|-----------|:-------:|:-------:|:-------:|-------|
| Modularity | 8 | 9 | 9.5 | Five clean extractions total; AgentService is now a thin orchestrator |
| Low Coupling | 7.5 | 8 | 9 | ValidationRunner and OutcomeResolver depend only on store/engine interfaces; AgentService dropped 3 direct dependencies |
| High Cohesion | 6 | 8 | 9 | Each extracted class owns exactly one concern; runAgentInBackground is now orchestration-only |
| Clear and Constrained State | 8.5 | 9 | 9.5 | ValidationRunner tracks validationPassed explicitly; OutcomeResolver owns effectiveOutcome lifecycle |
| Deterministic Behavior | 8.5 | 9 | 9 | No change -- retry guard from Round 2 still applies |
| Explicit Dependency Structure | 9 | 9 | 9.5 | Constructor injection in all new classes; OutcomeResolver receives worktreeManager per-call (correct scoping) |
| Observability | 9 | 9 | 9 | No change -- logging carried over faithfully |
| Robust Error Handling | 8.5 | 9 | 9 | No change -- error handling preserved in extraction |
| Simplicity of Structure | 6.5 | 8 | 9 | AgentService 673 lines; runAgentInBackground ~250 lines; clear delegation pattern |
| Performance Predictability | 9 | 9 | 9 | No change -- already well-controlled |

| Category | Score |
|----------|:-----:|
| **Logic** | 9.5/10 -- All extractions behavior-preserving; validation passed-flag fix improves correctness |
| **Bugs** | 9.5/10 -- No known correctness bugs; misleading log fixed in Round 3 |
| **Docs** | 9/10 -- No change from Round 2 |
| **Code Quality** | 9.5/10 -- AgentService now a clean orchestrator; all concerns separated into focused modules |

**Overall: 9.3 / 10** (up from 9.0)
