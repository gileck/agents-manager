# Architecture Review: Template Infrastructure (Round 2 Re-review)

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** Framework / Template Infrastructure (`template/`)
**Previous Score:** 7.3 / 10
**Updated Score:** 8.1 / 10

## Round 2 Changes Implemented

1. **Dead cron exports removed from `src/renderer/lib/utils.ts`** -- `_formatHour`, `formatTime`, `formatCronSchedule`, `formatIntervalSchedule` are gone. File is now 54 lines of focused app-specific utilities plus a barrel re-export.
2. **Re-export barrel added in `src/renderer/lib/utils.ts`** -- `cn`, `formatDuration`, `stripAnsi` re-exported from `@template/renderer/lib/utils`, establishing clean app-layer indirection.
3. **18+ `@template/renderer/lib/utils` imports redirected** -- All `src/` component files now import from `../../lib/utils` (the app-layer barrel). Zero direct template imports remain in `src/` consumers.
4. **`src/renderer/hooks/useTheme.ts` wrapper created** -- Re-exports `useTheme` from template. Three import sites (`App.tsx`, `SettingsPage.tsx`, `TopMenu.tsx`) redirected to use the app-layer path.
5. **Cron parser stripped from `template/renderer/lib/utils.ts`** -- 139 lines of app-specific code removed. Template utils now contains only generic utilities (`cn`, `formatDuration`, `formatDate`, `formatRelativeTime`, `truncatePath`, `stripAnsi`).
6. **Dead `mainWindow` variable removed from `template/main/core/app.ts`** -- Variable and ESLint suppression deleted. File is clean: no dead assignments, no lint overrides.
7. **Shutdown ordering documented** -- Inline comment in `src/main/index.ts` explains flush-before-close invariant. New "Shutdown Ordering" section added to `docs/patterns.md`.
8. **Component layering convention documented** -- New "Component Layering Convention" section in `docs/patterns.md` lists the three intentional overrides (`dialog.tsx`, `tabs.tsx`, `toaster.tsx`) and explains when to override vs import from template.
9. **Intentional override components annotated** -- `dialog.tsx` and `tabs.tsx` in `src/renderer/components/ui/` have JSDoc comments explaining they are app-layer overrides adding `style` props.

## Round 2 Remaining Issues

1. **9 identical UI component duplicates** (P2) -- `badge.tsx`, `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `scroll-area.tsx`, `select.tsx`, `switch.tsx`, and `textarea.tsx` in `src/renderer/components/ui/` are byte-for-byte identical to their `template/` counterparts (modulo the import path for `cn`). These should be deleted from `src/` with imports redirected to `@template/renderer/components/ui/`. The component layering convention was documented but the actual deduplication was not performed.
2. **useTheme implicit contract** (P4) -- The app-layer wrapper (`src/renderer/hooks/useTheme.ts`) re-exports the template hook but does not add typed `window.api.settings` interface enforcement. The template hook still calls `window.api.settings.get()` and `window.api.settings.update()` without a TypeScript interface constraining the shape. The indirection layer exists but the type safety gap remains.
3. **Template utils still has app-specific functions** (P4) -- `formatDate`, `formatRelativeTime`, and `truncatePath` in `template/renderer/lib/utils.ts` are arguably app-specific rather than framework-generic utilities. They are also duplicated (identical copies exist in `src/renderer/lib/utils.ts` for `formatDate` and `formatRelativeTime`). The cron parser was removed, but these three functions remain as minor "Zero App Logic" violations.

## What Was Fixed (Round 1, preserved for reference)

1. **CLI getSetting() crash** (P1) -- `src/cli/commands/tasks.ts:89-96` wrapped in try/catch with fallback to pipeline list
2. **Log buffer flush on quit** (P1) -- `flushLogs()` called before `closeDatabase()` in onBeforeQuit
3. **Dead import in useTheme.ts** (P2) -- removed unused `AppSettings` cross-boundary import
4. **before-quit listener duplication** (P2) -- moved to module level in `window.ts` to prevent accumulation
5. **Dead bridge.ts** (P3) -- deleted (never imported, preload uses ipcRenderer directly)
6. **README documentation** -- documents Electron-only DB, window.api coupling, dual UI component rule

## Quality Ratings

| Dimension | Round 1 | Round 2 | Notes |
|-----------|:-------:|:-------:|-------|
| Modularity | 8 | 9 | App-layer barrels for utils and useTheme; cron parser removed from template |
| Low Coupling | 6 | 8 | Zero direct `@template/` imports from `src/` consumers; all go through app-layer indirection |
| High Cohesion | 6 | 8 | Template utils now generic-only; app-specific logic lives in `src/` |
| Clear and Constrained State | 8 | 8 | No change; shutdown ordering was already correct |
| Deterministic Behavior | 8 | 8 | No change |
| Explicit Dependency Structure | 6 | 8 | Component layering convention documented; override intent annotated with JSDoc |
| Observability | 7 | 7 | No change |
| Robust Error Handling | 8 | 8 | No change |
| Simplicity of Structure | 8 | 7 | 9 identical component duplicates add unnecessary complexity; partially offset by cleaner utils |
| Performance Predictability | 8 | 8 | No change |

| Category | Rating |
|----------|--------|
| **Logic** | 9/10 -- All P1/P2 bugs fixed; clean app-layer indirection established |
| **Bugs** | 9/10 -- Zero active bugs; only latent type-safety gap in useTheme |
| **Docs** | 8/10 -- Shutdown ordering, component layering, and override annotations all documented |
| **Code Quality** | 7/10 -- Significant improvement from dead code removal and import redirection, but 9 duplicate components remain |

**Overall: 8.1 / 10** (up from 7.3)

The major structural improvements (app-layer indirection, cron parser removal, dead variable cleanup, documentation) bring meaningful gains. The score is held back primarily by the 9 undeduplicated UI component copies, which add maintenance burden and contradict the documented layering convention. Resolving those duplicates would push the score into the 8.5-9.0 range.
