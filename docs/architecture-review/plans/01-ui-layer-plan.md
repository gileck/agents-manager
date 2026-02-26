# Plan 01: UI Layer (8.1 → 9+)

## Gap Analysis

- **Polling logic tightly coupled to TaskDetailPage** — 20-line `useEffect` block with interval + completion-edge flush is not reusable and clutters the page component
- **`useActiveAgentRuns` swallows all errors** — Three bare `catch {}` blocks hide API failures; no error state exposed to consumers
- **`HomePage.tsx` is orphaned** — Not routed in `App.tsx`, dead template artifact

## Changes

### 1. Extract `useTaskPolling` hook

**File:** `src/renderer/hooks/useTaskPolling.ts` (new)

Move the 3-second interval (`TaskDetailPage.tsx:103-114`) and completion-edge flush (`TaskDetailPage.tsx:116-123`) into a dedicated hook.

Interface:
```ts
function useTaskPolling(
  taskId: string | undefined,
  shouldPoll: boolean,
  hasRunningAgent: boolean,
  refetchers: { refetch: () => void; refetchTransitions: () => void; refetchAgentRuns: () => void; refetchPrompts: () => void; refetchDebug: () => void; refetchContext: () => void }
): void
```

Update `TaskDetailPage.tsx` to call `useTaskPolling(...)` instead of inline effects.

### 2. Fix `useActiveAgentRuns` silent catches

**File:** `src/renderer/hooks/useActiveAgentRuns.ts`

- Add `error` state: `const [error, setError] = useState<string | null>(null);`
- Replace outer `catch {}` (line 58) with `catch (err) { setError(String(err)); }`
- Replace inner catches (lines 26, 44) with `catch (err) { console.debug('useActiveAgentRuns:', err); }`
- Clear error on success: `setError(null)` at start of successful `fetchData`
- Return `error` in hook return value

### 3. Delete `HomePage.tsx`

**File:** `src/renderer/pages/HomePage.tsx` (delete)

Orphaned template artifact — not referenced in `App.tsx` routing. Confirm zero imports before deleting.

## Files to Modify

| File | Action |
|------|--------|
| `src/renderer/hooks/useTaskPolling.ts` | Create |
| `src/renderer/pages/TaskDetailPage.tsx` | Edit (replace inline effects with hook call) |
| `src/renderer/hooks/useActiveAgentRuns.ts` | Edit (add error handling) |
| `src/renderer/pages/HomePage.tsx` | Delete |

## Complexity

Small (~2 hours)
