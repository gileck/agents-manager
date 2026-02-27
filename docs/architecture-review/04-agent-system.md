# Architecture Review: Agent System

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** Agent System (AI Execution Layer)
**Previous Score: 8.5 / 10**
**Updated Score: 9.0 / 10**

## Round 2 Changes Implemented

1. **`AgentService` god-class decomposition** -- Three responsibilities extracted from `runAgentInBackground` (~280 lines removed):
   - `SubtaskSyncInterceptor` (124 lines) -- Owns `wrappedOnMessage` logic, `mapSdkStatus` helper, and `persistSubtaskChanges`. Clean constructor-injected class with single `handleMessage(msg)` entry point. Properly encapsulates the `sdkTaskIdToSubtaskName` map and `currentSubtasks` state.
   - `AgentOutputFlusher` (115 lines) -- Owns `outputBuffer`, `messagesBuffer`, `flushInterval`, periodic DB flush, and live cost/progress data extraction from the running agent. `start()`/`stop()` lifecycle, configurable constants (`MAX_OUTPUT_BUFFER`, `MAX_MESSAGES_BUFFER`, `FLUSH_INTERVAL_MS`), and error counting.
   - `PostRunExtractor` (240 lines) -- Owns plan extraction, technical design extraction, context entry saving, and raw-output parsing fallbacks. Each responsibility is a clean public method (`extractPlan`, `extractTechnicalDesign`, `saveContextEntry`).
   - `AgentService` reduced from ~1230 lines to 949 lines. `runAgentInBackground` now orchestrates the extracted classes rather than implementing all details inline.

2. **`ChatAgentService` SDK loop consolidation** -- New private `runSdkQuery()` helper (lines 609-654) encapsulates the SDK `query()` import, async iteration, and message-type dispatch. Both `runViaDirectSdk()` and `summarizeMessages()` now delegate to it via a `SdkQueryCallbacks` interface, eliminating the duplicated streaming loop.

3. **`isReadOnlyMode` JSDoc added** -- `base-agent-prompt-builder.ts` lines 55-64 now contain an explicit JSDoc block explaining why `technical_design*` modes are excluded from the read-only guard (agent may need to create design artifacts or scaffolding files in the worktree).

4. **Validation retry run-ID guard** -- `agent-service.ts` lines 493-505 now verify that the run being retried (`run.id`) still belongs to the current task before proceeding. If mismatched, the retry is aborted with a descriptive error log. This closes the previously noted token misattribution risk.

5. **Hand-rolled SDK types retained (intentional)** -- `chat-agent-service.ts` lines 21-41 still define local mirrors of SDK stream types. The JSDoc at line 13 explains this is intentional: it avoids a hard compile-time dependency on the ESM-only `@anthropic-ai/claude-agent-sdk` package that is dynamically imported at runtime. This is a defensible trade-off, not a debt item.

## Round 2 Remaining Issues

1. **`AgentService` still 949 lines** (Low) -- The extraction reduced it by ~280 lines, but it still mixes worktree management, environment preparation, validation loop, outcome transition, notification, and queue processing in `runAgentInBackground`. Further extraction (e.g., a `WorktreeEnvironmentPreparer` or `ValidationLoop` class) could bring it under 600 lines. Currently manageable but worth tracking.

2. **`AgentOutputFlusher` uses `agent as unknown as { ... }` casts** (Low) -- Lines 84-89 access agent telemetry fields via unsafe type casts. A small `AgentTelemetry` interface on `IAgent` would make this type-safe, but the current approach works correctly.

3. **`SubtaskSyncInterceptor.handleMessage` silently swallows parse errors** (Info) -- `JSON.parse(msg.input)` failures are caught and logged but the calling code has no way to distinguish a handled tool_use from a malformed one. Acceptable for fire-and-forget sync, but a metrics counter would improve observability.

4. **`ChatAgentService` cleanup timeouts are hard-coded** (Info) -- 5-second `setTimeout` for agent cleanup (lines 202, 456) and 1-hour staleness threshold (line 296) are magic numbers. Named constants would improve readability.

## What Was Fixed (Round 1)

1. **Bug 1: `Agent.isAvailable()` hardcoded `claude-code`** -- Fixed: constructor accepts `defaultEngine`, `isAvailable()` uses it.
2. **Bug 2: `listAgents()` returned `available: false`** -- Fixed: returns optimistic `available: true`; async real check in `getAvailableAgents()`.
3. **Bug 3: Validation retry omitted 4 of 6 callbacks** -- Fixed: all 6 forwarded at `agent-service.ts:518`.
4. **Bug 4: Supervisor timeout < implement timeout** -- Fixed: default raised to 35 min; per-run `timeoutMs + 5 min grace`.
5. **Issue 6: `review` mode not in read-only guard** -- Fixed: `base-agent-prompt-builder.ts:67` includes `'review'`.
6. **Doc gaps: PromptRenderer, ChatAgentService, AgentSupervisor, SandboxGuard undocumented** -- Fixed: all four fully documented.
7. **Test gap: ImplementorPromptBuilder** -- Fixed: 69-test suite covering all 13 modes, phase display, readOnly flag, needs_info, timeout overrides.

## Quality Ratings

| Dimension | Round 1 | Round 2 | Notes |
|-----------|:-------:|:-------:|-------|
| Modularity | 8 | 9 | Three clean extractions with single-responsibility classes |
| Low Coupling | 7.5 | 8 | Extracted classes depend only on store interfaces |
| High Cohesion | 6 | 8 | AgentService delegates instead of implementing; each extracted class owns one concern |
| Clear and Constrained State | 8.5 | 9 | Flusher owns buffer lifecycle; Interceptor owns subtask state |
| Deterministic Behavior | 8.5 | 9 | Validation retry guard prevents misattribution |
| Explicit Dependency Structure | 9 | 9 | Constructor injection maintained in all new classes |
| Observability | 9 | 9 | Flusher error counting, interceptor logging, postrun logging |
| Robust Error Handling | 8.5 | 9 | Retry guard, flusher error throttling, interceptor catch-and-log |
| Simplicity of Structure | 6.5 | 8 | SDK loop consolidated; god-class partially decomposed |
| Performance Predictability | 9 | 9 | No change -- already well-controlled |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 -- All extraction is behavior-preserving; new retry guard adds correctness |
| **Bugs** | 9.5/10 -- Retry misattribution risk closed; no known correctness bugs remain |
| **Docs** | 9/10 -- isReadOnlyMode JSDoc, SDK type rationale, PostRunExtractor class docs |
| **Code Quality** | 8.5/10 -- Cohesion significantly improved; AgentService still large but well-structured |

**Overall: 9.0 / 10** (up from 8.5)
