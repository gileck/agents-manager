# Architecture Review: Implementation Order

This document describes the execution order for the 9 implementation plans, based on file-level conflict analysis and logical dependencies.

---

## File Conflict Summary

The critical bottleneck is `src/main/ipc-handlers.ts` — **6 plans modify it** (01, 02, 05, 07, 08). Additionally, `src/main/services/agent-service.ts` is modified by **3 plans** (03, 04, 07).

**Key insight:** Splitting `ipc-handlers.ts` into domain files FIRST (Wave 0) eliminates the bottleneck and unlocks significantly more parallelism.

### Shared Files Between Plans

| File | Plans | Risk |
|------|-------|------|
| `src/main/ipc-handlers.ts` | 01, 02, 05, 07, 08 | **Critical** → resolved by Wave 0 split |
| `src/main/services/agent-service.ts` | 03, 04, 07 | **Medium** (different methods) |
| `src/shared/types.ts` | 05, 08 | Medium (different sections) |
| `src/main/index.ts` | 06, 09 | Low (onReady vs onBeforeQuit) |
| `docs/architecture-overview.md` | 02, 07 | Low (different sections) |
| `src/main/interfaces/chat-session-store.ts` | 05, 08 | Medium (overlapping) |
| `src/main/interfaces/index.ts` | 05, 08 | Medium (overlapping) |
| `docs/ipc-and-renderer.md` | 01, 08 | **Duplicate work** |

### Duplicate Items Between Plans

Plans 01 (UI Layer) and 08 (Shared/Cross-cutting) contain **3 duplicate items** that must be merged, not executed twice:

| Item | Plan 01 | Plan 08 |
|------|---------|---------|
| Fix `AGENT_SEND_MESSAGE` dead code | Item 3 | Item 2 |
| Split `ipc-handlers.ts` into domain files | Item 7 | Item 7 |
| Create `ipc-channel-sync.test.ts` | Item 6 | Item 6 |

**Resolution:** The IPC split is now Wave 0 (done before all plans). The other two duplicates merge into Plan 08. Plan 01 focuses on docs + preload + CLI fixes.

---

## Execution Waves

### Wave 0 — IPC Handler Split (prerequisite)

Split the monolithic `src/main/ipc-handlers.ts` (954 lines) into domain-scoped files. This is a purely mechanical refactor — no logic changes, same public API.

```
src/main/ipc-handlers.ts (954 lines)
  ├──> src/main/ipc-handlers/settings-handlers.ts    (lines 68-125)
  ├──> src/main/ipc-handlers/agent-handlers.ts        (lines 280-341)
  ├──> src/main/ipc-handlers/kanban-handlers.ts        (lines 442-474)
  ├──> src/main/ipc-handlers/telegram-handlers.ts      (lines 636-717)
  ├──> src/main/ipc-handlers/chat-session-handlers.ts  (lines 763-864)
  ├──> src/main/ipc-handlers/shell-handlers.ts         (lines 866-929)
  ├──> src/main/ipc-handlers/git-handlers.ts           (lines 516-633, 930-954)
  └──> src/main/ipc-handlers/index.ts                  (remaining ~400 lines + re-exports)
```

Each file exports `register*Handlers(services)`. The main `ipc-handlers/index.ts` calls all of them.

**Why first:** After this split, each plan only touches its own domain file. The bottleneck disappears.

**Post-split plan-to-file mapping:**

| Domain File | Plans That Modify It |
|-------------|---------------------|
| `settings-handlers.ts` | Plan 08 only |
| `agent-handlers.ts` | Plans 02, 08 (still sequential) |
| `kanban-handlers.ts` | Plan 08 only |
| `telegram-handlers.ts` | Plan 07 only |
| `chat-session-handlers.ts` | Plan 05 only |
| `shell-handlers.ts` | None (already clean) |
| `git-handlers.ts` | None (already clean) |
| `index.ts` (remaining) | Plans 01, 02 (docs/preload only) |

---

### Wave 1 — Fully Independent (run in parallel)

These plans touch completely separate file sets with zero or negligible overlap.

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Plan 03         │  │  Plan 06         │  │  Plan 09         │
│  Pipeline Engine │  │  SCM/Git         │  │  Template Infra  │
│  Score: 8.2→9.0  │  │  Score: 7.4→9.0  │  │  Score: 6.3→8.0  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

| Plan | Key Files | Conflict Notes |
|------|-----------|----------------|
| **03 Pipeline Engine** | `pipeline-engine.ts`, `agent-service.ts` (tryOutcomeTransition only), `pipeline-engine.md` | agent-service.ts line ~1168 — distinct from Plan 04's line 613 and Plan 07's lines 962-970 |
| **06 SCM/Git** | `local-worktree-manager.ts`, `shell-env.ts`, `github-scm-platform.ts`, `index.ts` (onReady) | index.ts: adds `initShellEnv()` in onReady — different callback from Plan 09's onBeforeQuit |
| **09 Template Infra** | `cli/commands/tasks.ts`, `template/*` files, `index.ts` (onBeforeQuit) | index.ts: adds `flushLogs()` in onBeforeQuit — different callback from Plan 06's onReady |

**Risk:** Minimal. Plan 06 and 09 both touch `src/main/index.ts` but in different callbacks (`onReady` vs `onBeforeQuit`). Merge conflict is trivially resolvable.

---

### Wave 2 — Unlocked by Wave 0 Split (run in parallel)

After the IPC split, these plans each touch **isolated domain files** and can all run in parallel.

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Plan 04         │  │  Plan 05         │  │  Plan 07         │  │  Plan 08 (bugs) │
│  Agent System    │  │  Data Layer      │  │  Notifications   │  │  Shared Fixes   │
│  Score: 7.6→9.0  │  │  Score: 7.5→9.0  │  │  Score: 5.9→9.0  │  │  Score: 6.8→9.0 │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

| Plan | Key Files | Conflict Notes |
|------|-----------|----------------|
| **04 Agent System** | `agent.ts`, `agent-supervisor.ts`, `agent-service.ts` (line 613), `base-agent-prompt-builder.ts` | agent-service.ts: line 613 only. Should land after Plan 03 (Wave 1) |
| **05 Data Layer** | `chat-session-store.test.ts`, `sqlite-feature-store.ts`, `chat-session-handlers.ts` (isolated), `shared/types.ts` | Chat session handlers now in own file — fully independent |
| **07 Notifications** | `telegram-bot-service.ts`, `agent-service.ts` (lines 962-970), `telegram-handlers.ts` (isolated) | Telegram handlers now in own file — fully independent |
| **08 Shared (bugs)** | `cost-utils.ts`, `agent-handlers.ts`, `settings-handlers.ts`, `kanban-handlers.ts`, `interfaces/*`, `shared/types.ts` | Touches 3 handler files, but no other plan needs them |

**Remaining conflict:** Plans 02 and 08 both touch `agent-handlers.ts` (AGENT_SEND_MESSAGE section). Plan 08's bug fix must land before Plan 02's `resumeAgent()` extraction. **Run Plan 08 items touching `agent-handlers.ts` before Plan 02.**

**Risk:** Low. The only ordering constraint within Wave 2 is Plan 08 → Plan 02 on `agent-handlers.ts`. All other plans are fully independent.

---

### Wave 3 — Final (depends on Wave 2)

```
┌─────────────────┐  ┌──────────────────┐
│  Plan 02         │  │  Plan 01 + docs  │
│  WorkflowService │  │  Preload + CLI   │
│  Score: 6.8→9.0  │  │  Score: 7.2→9.0  │
└─────────────────┘  └──────────────────┘
```

#### Step 3a: Plan 02 — WorkflowService

- Fix dead code in `updateTask`
- Add `resumeAgent()` to WorkflowService (replaces `AGENT_SEND_MESSAGE` handler logic)
- Fix `getDashboardStats` with SQL aggregation
- Make optional deps required
- Parallelize `getPipelineDiagnostics`
- Document 4 missing methods

**Why after Wave 2:** The `resumeAgent()` method **replaces** the `AGENT_SEND_MESSAGE` handler that Plan 08 already cleaned up in Wave 2.

#### Step 3b: Plan 01 — Docs + Preload + CLI

- Create preload channel sync test
- Expose `agentLib` in preload
- Add `--all` flag to CLI agent runs
- Rewrite `docs/ipc-and-renderer.md`
- Update `docs/cli-reference.md`
- Add unit tests for shared utilities (08 Item 9)

**Why last:** Docs should reflect the final state after all code changes. The preload sync test needs all IPC channels finalized.

---

## Complete Execution Timeline

```
Day 1 ──────────────────────────────────────────────────
  Wave 0 (prerequisite):
    └── Split ipc-handlers.ts into domain files  [~2 hours]

Day 1-3 ────────────────────────────────────────────────
  Wave 1 (parallel):
    ├── Plan 03: Pipeline Engine        [~6 hours]
    ├── Plan 06: SCM/Git Integration    [~8 hours]
    └── Plan 09: Template Infrastructure [~3 hours]

Day 2-5 ────────────────────────────────────────────────
  Wave 2 (parallel, after Wave 0 + Wave 1):
    ├── Plan 04: Agent System           [~8 hours]
    ├── Plan 05: Data Layer             [~4 hours]  ← was Wave 3b
    ├── Plan 07: Notifications          [~4 hours]
    └── Plan 08: Shared bug fixes       [~3 hours]  ← was Wave 3a

Day 4-6 ────────────────────────────────────────────────
  Wave 3 (after Wave 2):
    ├── Plan 02: WorkflowService        [~6 hours]  ← was Wave 3c
    └── Plan 01: Docs + preload + CLI   [~6 hours]  ← was Wave 3d
```

**Improvement over original:** Wave 0 split converts a 4-step sequential chain (08→05→02→01) into 4 parallel plans + 2 sequential follow-ups. Saves ~7 hours of sequential wait time.

---

## Dependency Graph (Visual)

```
                         ┌──────────────────┐
                         │    Wave 0         │
                         │  IPC Split        │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              v                   v                   v
        ┌──────────┐        ┌──────────┐        ┌──────────┐
        │ Plan 03  │        │ Plan 06  │        │ Plan 09  │
        │ Pipeline │        │ SCM/Git  │        │ Template │
        └────┬─────┘        └──────────┘        └──────────┘
             │
     ┌───────┼───────────────────────────────────┐
     │       │                                   │
     v       v               v                   v
┌──────────┐ ┌──────────┐ ┌──────────┐   ┌──────────┐
│ Plan 04  │ │ Plan 07  │ │ Plan 05  │   │ Plan 08  │
│ Agent    │ │ Notifs   │ │ Data     │   │ Shared   │
└──────────┘ └──────────┘ └──────────┘   └────┬─────┘
                                              │
                                              v
                                        ┌──────────┐
                                        │ Plan 02  │
                                        │ Workflow │
                                        └────┬─────┘
                                              │
                                              v
                                        ┌──────────┐
                                        │ Plan 01  │
                                        │ Docs/CLI │
                                        └──────────┘
```

**Legend:**
- Horizontal level = can run in parallel
- Arrows = "should complete before"
- Wave 0 unblocks everything
- Plans 04, 05, 07, 08 run in parallel (Wave 2)
- Plan 02 waits for Plan 08 only (agent-handlers.ts dependency)
- Plan 01 runs last (docs should reflect final state)

---

## Risk Mitigation

1. **Wave 0 split risk:** The IPC split is mechanical (no logic changes) but touches every handler registration. Run `yarn checks` and existing tests immediately after to verify nothing broke.

2. **`agent-service.ts` three-way:** Plans 03, 04, 07 all touch this file. Wave 1 (Plan 03) lands first, then Wave 2 (04/07) rebases cleanly since all changes are in different methods.

3. **`src/main/index.ts` two-way:** Plans 06 and 09 both add to `index.ts`. Running in Wave 1 together is fine — 06 adds to `onReady`, 09 adds to `onBeforeQuit`. Auto-merge should handle this.

4. **Plan 08 → Plan 02 ordering:** Within Wave 2, Plan 08's AGENT_SEND_MESSAGE fix must land before Plan 02's `resumeAgent()` extraction. Run Plan 08's `agent-handlers.ts` items first, then Plan 02 can proceed.

5. **Documentation can always be parallelized:** Doc updates (`docs/*.md`) have no runtime conflicts. If the code changes from a wave are done, docs can be written alongside later waves.

---

## Quick Reference: Plan → Wave

| Plan | Wave | Can Parallel With |
|------|------|-------------------|
| IPC Split | Wave 0 | — (prerequisite) |
| 03 Pipeline Engine | Wave 1 | 06, 09 |
| 06 SCM/Git | Wave 1 | 03, 09 |
| 09 Template Infra | Wave 1 | 03, 06 |
| 04 Agent System | Wave 2 | 05, 07, 08 |
| 05 Data Layer | Wave 2 | 04, 07, 08 |
| 07 Notifications | Wave 2 | 04, 05, 08 |
| 08 Shared (bugs) | Wave 2 | 04, 05, 07 |
| 02 WorkflowService | Wave 3 | 01 (if no agent-handlers overlap) |
| 01 Docs + CLI | Wave 3 | — (last) |
