# Implementation Plan: Template Infrastructure Fixes

**Review:** `docs/architecture-review/09-template-infrastructure.md`
**Current Score:** 6.3 / 10
**Target Score:** ~8.0 / 10
**Constraint:** CLAUDE.md says "Never modify files in `template/`". Each item notes whether a template modification is justified.

---

## Item 1 (P1): Protect CLI `getSetting()` -- ACTIVE BUG

**File:** `src/cli/commands/tasks.ts` (line 90)
**Complexity:** Small | **Template mod:** No

Wrap `getSetting('default_pipeline_id', '')` in try/catch (template DB singleton not initialized in CLI context). Fall back to first pipeline from `pipelineStore.listPipelines()`. Pattern already established in `src/main/providers/setup.ts:199-205`.

---

## Item 2 (P1): Flush log buffer on quit

**File:** `src/main/index.ts`
**Complexity:** Small | **Template mod:** No

Add `flushLogs()` call at top of `onBeforeQuit` callback, before `closeDatabase()`. The `flushLogs` function is already exported from `@template/main/services/log-service`.

---

## Item 3 (P2): Remove dead import from `useTheme.ts`

**File:** `template/renderer/hooks/useTheme.ts` (line 2)
**Complexity:** Small | **Template mod:** YES (justified -- dead cross-boundary import)

Delete line 2: `import type { AppSettings as _AppSettings } from '@shared/types'`. Zero behavioral change.

---

## Item 4 (P2): Move `before-quit` listener out of `createWindow()`

**File:** `template/main/core/window.ts` (lines 27-30)
**Complexity:** Small | **Template mod:** YES (justified -- listener leak bug)

Move `app.on('before-quit', ...)` from inside `createWindow()` to module level. Prevents duplicate listener accumulation on multiple calls.

---

## Item 5 (P3): Remove dead `bridge.ts`

**Files:** Delete `template/preload/bridge.ts`, update `template/README.md`
**Complexity:** Small | **Template mod:** YES (justified -- dead code, never imported)

The actual preload (`src/preload/index.ts`) uses raw `ipcRenderer.invoke` directly.

---

## Items 6-10 (P4-P6): Documentation Quick Wins

All template README updates:
- **Item 6:** Document UI component import rule (use `src/` components, not `template/`)
- **Item 7:** Extract app-specific helpers from `template/renderer/lib/utils.ts` to `src/`
- **Item 8:** Document Electron-only constraint of `database.ts`
- **Item 9:** Document `useTheme.ts` coupling to `window.api.settings`
- **Item 10:** Document which UI component set to use

---

## Execution Order

| Step | Item | Template Mod? |
|------|------|---------------|
| 1 | Item 1: CLI getSetting protection | No |
| 2 | Item 2: Flush logs on quit | No |
| 3 | Item 3: Remove dead import | Yes (1 line) |
| 4 | Item 4: Move before-quit listener | Yes (move code) |
| 5 | Item 5: Remove dead bridge.ts | Yes (delete file) |
| 6 | Items 6-10: Documentation | Yes (docs only) |
| 7 | Item 7: Extract app helpers | Yes (remove + repoint) |

---

## Expected Score Impact

| Dimension | Before | After | Delta |
|-----------|:------:|:-----:|:-----:|
| Low Coupling | 5 | 7 | +2 |
| High Cohesion | 6 | 7 | +1 |
| Clear State | 6 | 7 | +1 |
| Deterministic | 7 | 8 | +1 |
| Error Handling | 6 | 7 | +1 |

**Projected: ~7.5-8.0 / 10** (reaching 9.0 requires larger refactors like making `useTheme.ts` injectable)
