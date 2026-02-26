# Architecture Review: Template Infrastructure

**Date:** 2026-02-26
**Component:** Framework / Template Infrastructure (`template/`)
**Overall Score: 6.3 / 10**

## Files Reviewed

- All files in `template/main/core/`, `template/main/services/`, `template/main/ipc/`
- `template/preload/bridge.ts`
- `template/renderer/hooks/`, `template/renderer/lib/`, `template/renderer/components/`
- `template/shared/base-types.ts`, `template/shared/ipc-base.ts`
- `template/README.md`, `docs/TEMPLATE.md`, `docs/development-guide.md`, `docs/architecture-overview.md`
- Integration consumers: `src/main/index.ts`, `src/preload/index.ts`, `src/cli/db.ts`, `src/cli/commands/tasks.ts`

---

## 1. Summary of Findings

The template provides well-documented Electron boilerplate that cleanly separates framework from application code at the macro level. However, six concrete violations exist at integration seams: one confirmed runtime bug in the CLI, two coupling violations (dead cross-boundary import and hardcoded `window.api`), dead preload utility code, utility function scope creep, and duplicate UI component sets.

---

## 2. Doc Sufficiency Assessment

**Well documented:**
- `template/` vs `src/` boundary stated in every relevant doc
- `@template/*` path alias convention explained
- Every module has a summary description
- 9-step feature addition tutorial
- Configuration patterns (AppConfig, DatabaseConfig, TrayConfig)

**Missing from documentation:**
- `database.ts` is Electron-only (calls `app.getPath('userData')`) — incompatible with CLI
- `preload/bridge.ts` is documented but never used
- Duplicate `src/renderer/components/ui/` set has no documented resolution
- No template versioning or upgrade path
- `useTheme.ts` hardcodes `window.api.settings` contract (undocumented coupling)

**Rating: Sufficient for intent; insufficient for known deviations.**

---

## 3. Implementation vs Docs Gaps

### Gap 1 — `database.ts` is Electron-only (docs claim generic)

`app.getPath('userData')` from Electron API cannot be called in CLI context. CLI correctly avoids it by passing `db` directly to `createAppServices()`.

### Gap 2 — `useTheme.ts` has dead import from app code

Line 2: `import type { AppSettings as _AppSettings } from '@shared/types'` — unused, crosses the template/app boundary.

### Gap 3 — `useTheme.ts` hardcodes `window.api.settings` contract

Calls `window.api.settings.get()` and `window.api.settings.update()` directly. Not portable outside this specific app.

### Gap 4 — `bridge.ts` is dead code

Documented as core preload infrastructure. `src/preload/index.ts` bypasses it entirely, using raw `ipcRenderer.invoke` and `contextBridge.exposeInMainWorld`.

### Gap 5 — `utils.ts` contains app-specific helpers

222 lines including cron expression parsing (100+ lines), ANSI stripping, and path truncation. These are not generic Electron infrastructure.

### Gap 6 — Duplicate UI component sets

`template/renderer/components/ui/` has 10 components. `src/renderer/components/ui/` has 12 nearly-identical components with minor variants (badge adds `success`/`warning`, card changes border radius, toaster only in `src/`). App code imports from both with no documented rule.

---

## 4. Bugs Found

### Bug 1 (Active) — CLI `getSetting()` Calls Uninitialised Electron Singleton (High)

**File:** `src/cli/commands/tasks.ts:90`

`getSetting('default_pipeline_id', '')` calls `getDatabase()` which returns the Electron-only module singleton. CLI never calls `initDatabase()`. This throws `"Database not initialized"` when running `agents-manager tasks create` without `--pipeline`.

The same call in `src/main/providers/setup.ts:201` is protected by try/catch. The CLI call is **unprotected**.

**Fix:** Wrap in try/catch, or initialize the global singleton from `openDatabase()`.

### Bug 2 (Latent) — `createWindow()` Registers `before-quit` on Every Call (Low)

**File:** `template/main/core/window.ts:28`

The listener is inside `createWindow()`. Multiple calls (from `activate` handler or `showWindow()`) accumulate duplicate listeners. Effect is idempotent but listeners are never removed.

**Fix:** Move to module-level, outside `createWindow()`.

### Bug 3 (Latent) — Log Buffer Not Flushed on Quit (Low)

**File:** `template/main/services/log-service.ts`

No `before-quit` hook to force-flush pending log entries. If the app quits while the 500ms timer is pending, buffered entries are lost.

**Fix:** Call `flushLogs()` in `onBeforeQuit`.

---

## 5. Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Modularity** | 7 | Clear modules for core/services/ipc/preload/renderer. Weakened by `utils.ts` scope creep and dead `bridge.ts`. |
| **Low Coupling** | 5 | `useTheme.ts` hardcodes `window.api`; `database.ts` imports Electron `app`; `settings-service.ts` binds to Electron-only singleton; dead cross-boundary import. |
| **High Cohesion** | 6 | Each module has clear purpose except `utils.ts` (mixes generic utility, time formatting, ANSI stripping, cron parsing). |
| **Clear and Constrained State** | 6 | Database/window/log singletons are controlled. Multiple-listener bug slightly degrades. |
| **Deterministic Behavior** | 7 | Migrations idempotent. Window show/hide deterministic. Log flushing timer-based (non-deterministic at quit). |
| **Explicit Dependency Structure** | 5 | Functions implicitly depend on Electron `app` singleton and uninitialised `db` singleton. `useTheme.ts` implicitly depends on `window.api`. |
| **Observability** | 6 | Main-process errors logged. Window events logged. No structured logging or log levels. |
| **Robust Error Handling** | 6 | Migration failures halt startup (correct). `useTheme.ts` has try/catch. CLI `getSetting()` is unprotected. |
| **Simplicity of Structure** | 7 | Template is small and focused. Duplicate UI components and unused bridge add surface area. |
| **Performance Predictability** | 8 | Buffered log writes, WAL mode, prepared statements. No N+1 patterns. Migrations run once at startup. |

**Overall: 6.3 / 10**

---

## 6. Action Items (Prioritized)

### P1 — Fix Active Bugs

1. **Protect `getSetting()` in `src/cli/commands/tasks.ts:90`** — wrap in try/catch or initialize template DB singleton from CLI
2. **Flush log buffer on quit** — call `flushLogs()` in `onBeforeQuit`

### P2 — Eliminate Coupling Violations

3. **Remove dead import from `useTheme.ts`** — line 2
4. **Move `before-quit` listener out of `createWindow()`** — register at module level

### P3 — Resolve Dead Code

5. **Either use or remove `bridge.ts`** — refactor preload to use it, or delete it and update docs

### P4 — Resolve Duplicate UI Components

6. **Establish single authoritative source** — document when to import from `template/` vs `src/` components, or consolidate into one location

### P5 — Move Scope-Crept Utilities

7. **Extract app-specific helpers from `template/renderer/lib/utils.ts`** — move `truncatePath`, `stripAnsi`, `formatCronSchedule`, `formatIntervalSchedule` to `src/renderer/lib/`

### P6 — Documentation

8. **Document Electron-only constraint of `database.ts`**
9. **Document `useTheme.ts` coupling** to `window.api.settings`
10. **Document which UI component set to use**
