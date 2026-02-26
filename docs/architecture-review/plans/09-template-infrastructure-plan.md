# Plan 09: Template Infra (7.3 → 9+)

## Gap Analysis

- **Dead cron exports in `src/renderer/lib/utils.ts`** — `_formatHour`, `formatTime`, `formatCronSchedule`, `formatIntervalSchedule` have zero import sites
- **`src/` components import directly from `@template/`** — 18+ import sites bypass the app-layer indirection
- **`useTheme` imported directly from template** — 3 components use `@template/renderer/hooks/useTheme`
- **Cron parser in template violates "Zero App Logic"** — 139 lines of app-specific code in template
- **Dead `mainWindow` variable in template** — Unused + ESLint suppression in `template/main/core/app.ts`
- **No shutdown ordering documentation** — `flushLogs` ordering not documented
- **Duplicate UI component sets** — `template/` and `src/` both have component sets with diverged variants (P3)

**Note:** CLAUDE.md says "Never modify files in `template/`". Items 6-7 require template modification but are architecturally justified: the template's own README states "Zero App Logic" and these are corrective fixes removing violations.

## Changes

### 1. Remove dead cron exports from `src/renderer/lib/utils.ts`

**File:** `src/renderer/lib/utils.ts`

Delete `_formatHour`, `formatTime`, `formatCronSchedule`, `formatIntervalSchedule` functions (zero import sites — confirm with grep first).

### 2. Add re-export barrel in `src/renderer/lib/utils.ts`

**File:** `src/renderer/lib/utils.ts`

Add:
```ts
export { cn, formatDuration, stripAnsi } from '@template/renderer/lib/utils';
```

### 3. Redirect 18 `@template/renderer/lib/utils` imports

**Files:** ~18 component files in `src/renderer/`

Change all `src/` component imports from `@template/renderer/lib/utils` to use relative path `../../lib/utils` (or equivalent).

### 4. Create `src/renderer/hooks/useTheme.ts` wrapper

**File:** `src/renderer/hooks/useTheme.ts` (new)

Re-export with typed `window.api` interface. Redirect 3 import sites (`App.tsx`, `SettingsPage.tsx`, `TopMenu.tsx`).

### 5. Add flushLogs ordering comment

**Files:** `src/main/index.ts`, `docs/patterns.md`

- Add comment at `src/main/index.ts:72` explaining shutdown ordering
- Add "Shutdown Ordering" section in `docs/patterns.md`

### 6. Strip cron parser from `template/renderer/lib/utils.ts`

**File:** `template/renderer/lib/utils.ts`

Remove ~139 lines of app-specific cron parsing code. This is a justified template modification — the template's own README says "Zero App Logic" and the cron parser is identified as a violation.

### 7. Remove stale `mainWindow` from `template/main/core/app.ts`

**File:** `template/main/core/app.ts`

Remove the dead `mainWindow` variable and its ESLint suppression comment. Justified template modification.

### 8. Audit and document duplicate UI component sets

**Files:** `src/renderer/components/`, `template/renderer/components/`, `docs/patterns.md`

`template/` and `src/` both contain UI component sets (buttons, inputs, dialogs, etc.) that have diverged. Audit which `src/` components shadow or duplicate `template/` components:
- Identify `src/` components that are identical to their `template/` counterparts → delete `src/` copy and redirect imports to `@template/`
- Identify `src/` components that intentionally extend or override `template/` → add JSDoc noting the relationship
- Document the component layering convention in `docs/patterns.md` (which components live in template vs src, when to override)

## Files to Modify

| File | Action |
|------|--------|
| `src/renderer/lib/utils.ts` | Edit (remove dead exports, add barrel) |
| ~18 component files in `src/renderer/` | Edit (redirect imports) |
| `src/renderer/hooks/useTheme.ts` | Create |
| `src/renderer/pages/App.tsx` | Edit (redirect useTheme import) |
| `src/renderer/pages/SettingsPage.tsx` | Edit (redirect useTheme import) |
| `src/renderer/components/TopMenu.tsx` | Edit (redirect useTheme import) |
| `src/main/index.ts` | Edit (add comment) |
| `docs/patterns.md` | Edit (add section) |
| `template/renderer/lib/utils.ts` | Edit (remove cron parser) |
| `template/main/core/app.ts` | Edit (remove dead variable) |
| `src/renderer/components/*` | Audit (deduplicate or document overrides) |

## Complexity

Medium (~3 hours, mostly import redirects)
