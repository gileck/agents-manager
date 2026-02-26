# Architecture Review: Agent System

**Date:** 2026-02-26 (re-review)
**Component:** Agent System (AI Execution Layer)
**Previous Score: 7.6 / 10**
**Updated Score: 8.5 / 10**

## What Was Fixed

1. **Bug 1: `Agent.isAvailable()` hardcoded `claude-code`** — Fixed: constructor accepts `defaultEngine`, `isAvailable()` uses it.
2. **Bug 2: `listAgents()` returned `available: false`** — Fixed: returns optimistic `available: true`; async real check in `getAvailableAgents()`.
3. **Bug 3: Validation retry omitted 4 of 6 callbacks** — Fixed: all 6 forwarded at `agent-service.ts:613`.
4. **Bug 4: Supervisor timeout < implement timeout** — Fixed: default raised to 35 min; per-run `timeoutMs + 5 min grace`.
5. **Issue 6: `review` mode not in read-only guard** — Fixed: `base-agent-prompt-builder.ts:57` includes `'review'`.
6. **Doc gaps: PromptRenderer, ChatAgentService, AgentSupervisor, SandboxGuard undocumented** — Fixed: all four fully documented.
7. **Test gap: ImplementorPromptBuilder** — Fixed: 69-test suite covering all 13 modes, phase display, readOnly flag, needs_info, timeout overrides.

## Remaining Issues

1. **`ChatAgentService` duplicates SDK streaming loop** (Medium, deferred) — Two-path execution now documented but not consolidated.
2. **`AgentService` god-class cohesion** (Low-Medium) — 1230 lines mixing 10+ responsibilities. Correct but hard to unit test.
3. **Validation retry token attribution assumption** (Low) — Assumes `latestRunId` maps to correct retry run.
4. **`technical_design` modes not in read-only guard** (Info) — Defensible but unexplained.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 8 | 8 | Agent/PromptBuilder/AgentLib separation clean |
| Low Coupling | 7 | 7.5 | `isAvailable()` false dependency removed |
| High Cohesion | 6 | 6 | AgentService still mixes 10+ responsibilities |
| Clear and Constrained State | 8 | 8.5 | Per-runId Maps correct, ghost run detection |
| Deterministic Behavior | 7 | 8.5 | Multi-engine availability correct, all callbacks forwarded |
| Explicit Dependency Structure | 9 | 9 | Constructor injection throughout |
| Observability | 9 | 9 | Already exceptional |
| Robust Error Handling | 8 | 8.5 | Callback gap closed, supervisor timeout correct |
| Simplicity of Structure | 6 | 6.5 | ChatAgentService documented |
| Performance Predictability | 8 | 9 | Supervisor timeout conflict resolved |

| Category | Score |
|----------|:-----:|
| **Logic** | 8.5/10 — All mode-specific construction, inference, schemas correct |
| **Bugs** | 9/10 — No known correctness bugs remain |
| **Docs** | 8.5/10 — All four previously undocumented components documented |
| **Code Quality** | 7.5/10 — High at Agent/PromptBuilder/Lib level; AgentService is outlier |

**Overall: 8.5 / 10** (up from 7.6)
