# Architecture Review: Template Infrastructure (Post-Fix)

**Date:** 2026-02-26
**Component:** Framework / Template Infrastructure (`template/`)
**Previous Score:** 6.3 / 10
**Current Score:** 7.3 / 10

## What Was Fixed

1. **CLI getSetting() crash** (P1) — `src/cli/commands/tasks.ts:89-96` wrapped in try/catch with fallback to pipeline list
2. **Log buffer flush on quit** (P1) — `flushLogs()` called before `closeDatabase()` in onBeforeQuit
3. **Dead import in useTheme.ts** (P2) — removed unused `AppSettings` cross-boundary import
4. **before-quit listener duplication** (P2) — moved to module level in `window.ts` to prevent accumulation
5. **Dead bridge.ts** (P3) — deleted (never imported, preload uses ipcRenderer directly)
6. **README documentation** — documents Electron-only DB, window.api coupling, dual UI component rule

## Remaining Issues

1. **utils.ts scope creep** (P2) — 125-line cron parser still lives in template; should move to `src/`
2. **Duplicate UI component sets** (P3) — `template/` and `src/` both have component sets with diverged variants
3. **useTheme.ts implicit contract** (P4) — hardcodes `window.api.settings` with no interface enforcement
4. **Stale mainWindow in app.ts** (P5) — assigned but never read, ESLint suppressed
5. **flushLogs ordering invariant** (P6) — dependency on call order not documented in patterns.md

## Quality Ratings

| Dimension | Previous | Current | Notes |
|-----------|:--------:|:-------:|-------|
| Modularity | 7 | 8 | Dead bridge.ts removed |
| Low Coupling | 5 | 6 | Dead cross-boundary import gone; structural coupling documented |
| High Cohesion | 6 | 6 | utils.ts still mixes generic + app-specific |
| Clear and Constrained State | 6 | 8 | Before-quit listener deduplicated; flush ordering correct |
| Deterministic Behavior | 7 | 8 | Log flush-before-close removes quit-time data loss |
| Explicit Dependency Structure | 5 | 6 | README documents implicit deps |
| Observability | 6 | 7 | Logs now durable through quit |
| Robust Error Handling | 6 | 8 | CLI crash fixed; flushLogs has internal guard |
| Simplicity of Structure | 7 | 8 | Dead file and import removed |
| Performance Predictability | 8 | 8 | Unchanged |

| Category | Rating |
|----------|--------|
| **Logic** | 8/10 — All P1 bugs fixed, no active runtime issues |
| **Bugs** | 8/10 — Zero active bugs; latent issues are low-severity |
| **Docs** | 7/10 — README substantially improved; minor gaps remain |
| **Code Quality** | 7/10 — Cleaner after dead code removal; utils.ts scope creep persists |

**Overall: 7.3 / 10** (up from 6.3)
