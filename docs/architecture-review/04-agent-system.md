# Architecture Review: Agent System

**Date:** 2026-02-26
**Component:** Agent System (AI Execution Layer)
**Overall Score: 7.6 / 10**

## Files Reviewed

- `src/main/agents/agent.ts`, `base-agent-prompt-builder.ts`, `implementor-prompt-builder.ts`, `pr-reviewer-prompt-builder.ts`, `task-workflow-reviewer-prompt-builder.ts`, `scripted-agent.ts`
- `src/main/libs/claude-code-lib.ts`, `cursor-agent-lib.ts`, `codex-cli-lib.ts`
- `src/main/services/agent-lib-registry.ts`, `agent-service.ts`, `agent-supervisor.ts`, `chat-agent-service.ts`, `agent-framework-impl.ts`, `prompt-renderer.ts`, `sandbox-guard.ts`
- `src/main/interfaces/agent.ts`, `agent-lib.ts`, `agent-service.ts`, `agent-framework.ts`
- `docs/agent-system.md`

---

## 1. Summary of Findings

The agent system is the most sophisticated subsystem in agents-manager. It has a well-conceived three-part composition model (Agent + PromptBuilder + AgentLib), solid error handling at every layer, mature production concerns (telemetry, output buffering, orphan recovery, validation retry loops, supervisor watchdog), and a pluggable engine registry.

Key concerns: `Agent.isAvailable()` is hardcoded to `claude-code`, `ChatAgentService` duplicates the SDK streaming loop, `agent-service.ts` at 1200+ lines mixes too many responsibilities, and the supervisor timeout conflicts with implement-mode timeout.

---

## 2. Doc Sufficiency Assessment

### What docs cover well
- Architecture diagram (Agent/PromptBuilder/AgentLib composition)
- `IAgent` and `IAgentLib` interface signatures
- Execution lifecycle (8-step execute + background flow)
- Validation loop, orphan recovery, agent stop mechanism
- Mode table with max turns and timeouts
- Structured output schemas per mode
- Context accumulation pattern

### Documentation gaps

| Gap | Severity |
|-----|----------|
| Docs reference `src/main/agents/prompts/` directory — does not exist | High |
| `PromptRenderer` class undocumented (handles all DB-backed template rendering) | High |
| `ChatAgentService` has no documentation | Medium |
| `SandboxGuard` not documented | Medium |
| `AgentSupervisor` not documented | Medium |
| `technical_design*` modes absent from mode table | Low |
| Prompt template resolution path is stale (shows old `context.resolvedPrompt` flow) | Medium |

---

## 3. Implementation vs Docs Gaps

| Area | Docs Say | Implementation Does |
|------|----------|---------------------|
| Prompt resolution | `context.resolvedPrompt` / `resolvePromptTemplate()` | `context.modeConfig?.promptTemplate` → `PromptRenderer.render()` |
| `Agent.isAvailable()` | "Resolves IAgentLib from registry using config.engine" | Always checks `claude-code` regardless of configured engine |
| Prompt templates | "Live in `src/main/agents/prompts/`" | Directory does not exist; templates are in DB or hardcoded in builders |

---

## 4. Bugs and Issues Found

### Bug 1 — `Agent.isAvailable()` Hardcodes `claude-code` Engine (Medium)

**File:** `src/main/agents/agent.ts`, line 131

An agent configured for `cursor-agent` or `codex-cli` reports availability based on whether `claude-code` is installed. Misleads the availability UI for multi-engine setups.

**Fix:** Accept `defaultEngine` in constructor; use it in `isAvailable()`.

### Bug 2 — `AgentFrameworkImpl.listAgents()` Always Returns `available: false` (Low-Medium)

**File:** `src/main/services/agent-framework-impl.ts`, line 22

Synchronous `listAgents()` hardcodes `available: false` for every agent. Callers using this path see all agents as unavailable.

### Bug 3 — Validation Retry Omits Callbacks (Low)

**File:** `src/main/services/agent-service.ts`, line 613

Initial execution passes all 5 callbacks. Validation retry passes only 2 (`wrappedOnOutput`, `onLog`), omitting `onPromptBuilt` and `wrappedOnMessage`. Reduces observability during retry.

### Bug 4 — Supervisor Timeout Conflicts with Implement Mode (Medium)

**File:** `src/main/services/agent-supervisor.ts`, line 15

Supervisor default timeout is 15 minutes. `implement` mode has 30-minute timeout. Supervisor will kill implement agents at their midpoint.

**Fix:** Use per-run `timeoutMs` from DB with a grace period, or raise default to 35+ minutes.

### Issue 5 — `ChatAgentService` Duplicates SDK Streaming Loop (Medium, maintainability)

**File:** `src/main/services/chat-agent-service.ts`, `runViaDirectSdk()`

Near-copy of the streaming loop in `ClaudeCodeLib.execute()`. Both independently handle the ESM import workaround, `for await` message loop, and sandbox hook. They've already diverged in `user` message handling.

### Issue 6 — `review` Mode Not in Read-Only Guard (Low)

**File:** `src/main/agents/base-agent-prompt-builder.ts`, line 55

The PR review agent only reads code but isn't marked read-only. Should be added to `isReadOnlyMode`.

---

## 5. Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Modularity** | 8 | Agent, PromptBuilder, AgentLib cleanly separated. ChatAgentService is the exception. |
| **Low Coupling** | 7 | Interfaces respected throughout. Breaks where AgentService casts to access telemetry not on IAgent. |
| **High Cohesion** | 6 | AgentService (1200+ lines) mixes orchestration, git ops, worktree locking, subtask sync, output buffering, validation retry, and outcome routing. |
| **Clear and Constrained State** | 8 | State managed with Maps keyed by runId. Delayed cleanup gives crash handler time to read values. Consistent across success/failure/stop. |
| **Deterministic Behavior** | 7 | Prompt building deterministic for given context. `isAvailable()` bug introduces non-determinism for multi-engine. |
| **Explicit Dependency Structure** | 9 | Constructor injection throughout. All typed interfaces. No service locators or singletons. |
| **Observability** | 9 | Exceptional. Every meaningful event logged: worktree ops, rebase, prompt built, validation, tokens, subtask sync, outcome transitions, ghost runs. Telemetry polled 500ms, flushed 3s. |
| **Robust Error Handling** | 8 | Three-layer try-catch in `runAgentInBackground`. Orphan recovery on startup. Supervisor watchdog. Validation retry with cost tracking. Callback omission in retry is the main gap. |
| **Simplicity of Structure** | 6 | Composition pattern elegant. AgentService size and ChatAgentService duplicate streaming loop are structural burdens. |
| **Performance Predictability** | 8 | Output buffered at 5MB cap. DB flushed every 3s. Timeouts at SDK and supervisor levels. Supervisor/implement timeout mismatch is a gap. |

**Overall: 7.6 / 10**

---

## 6. Action Items (Prioritized)

### P1 — Fix Promptly

1. **Fix `Agent.isAvailable()`** — delegate to configured engine, not hardcoded `claude-code`
2. **Raise supervisor timeout** above implement mode timeout (30min), or derive per-run from `run.timeoutMs`
3. **Forward all callbacks in validation retry** — add `onPromptBuilt` and `wrappedOnMessage`
4. **Add `'review'` to read-only mode guard**

### P2 — Documentation

5. **Update prompt template resolution path** in `docs/agent-system.md` (stale code samples)
6. **Document `PromptRenderer`** with all template variables
7. **Remove `src/main/agents/prompts/` reference** — directory doesn't exist
8. **Document `ChatAgentService`** — two-path execution, history injection, scope resolution, summarize
9. **Document `AgentSupervisor` and `SandboxGuard`**
10. **Fix `AgentFrameworkImpl.listAgents()`** — don't hardcode `available: false`

### P3 — Structural

11. **Route ChatAgentService default path through ClaudeCodeLib** — eliminate duplicate streaming code
12. **Extract subtask sync** into dedicated `SubtaskSyncService` (~95 lines)
13. **Add unit tests for `ImplementorPromptBuilder`** — all 13 modes, phase-aware display, validation errors
14. **Note CLI backend token-count limitation** in docs (always returns 0)
