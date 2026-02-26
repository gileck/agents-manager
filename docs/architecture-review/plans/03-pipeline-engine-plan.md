# Plan 03: Pipeline Engine (9.1 → 9.3+)

## Gap Analysis

- **`executeForceTransition` lacks JSDoc** — The intentional design decision that required hook failures are non-fatal is not documented
- **`.catch(() => {})` on audit log calls** — 4 call sites silently swallow audit log failures
- **No guard-failure audit trail** — When a guard blocks a transition, no `transition_history` row is recorded

## Changes

### 1. JSDoc on `executeForceTransition`

**File:** `src/main/services/pipeline-engine.ts`

Add explicit JSDoc above `executeForceTransition` documenting:
- Required hook failures are intentionally non-fatal (no rollback)
- This is by design for force transitions
- Contrast with normal `executeTransition` behavior

### 2. Replace `.catch(() => {})` with `console.error` fallback

**File:** `src/main/services/pipeline-engine.ts`

On all 4 audit log `.catch(() => {})` call sites, replace with:
```ts
.catch((err) => console.error('Audit log write failed:', err))
```

This ensures audit log failures surface to stderr without breaking the transition flow.

### 3. Insert `transition_history` row on guard failure

**File:** `src/main/services/pipeline-engine.ts`

Inside the transaction, before the early return on guard failure, insert a `transition_history` record with:
```ts
{ _denied: true, guardFailures }
```

This completes the audit trail — every transition attempt (successful or denied) is recorded.

## Files to Modify

| File | Action |
|------|--------|
| `src/main/services/pipeline-engine.ts` | Edit (3 changes) |

## Complexity

Small (~1 hour)
