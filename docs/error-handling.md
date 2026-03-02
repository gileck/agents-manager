---
title: Error Handling Guidelines
description: Error display patterns, user-facing error requirements, and error handling rules
summary: All errors must be visible to the user via toast notifications or inline error components. Three display patterns — reportError() for async operations, InlineError for data loading, ErrorBoundary for render crashes. Never use bare console.error or empty catch blocks.
priority: 1
guidelines:
  - "NEVER use bare `console.error` in renderer code — always pair with `reportError()` or `<InlineError>`"
  - "NEVER use empty `.catch(() => {})` — at minimum use `.catch((err) => reportError(err, 'Context'))`"
  - "Every error the user triggers must be visible via toast or inline error with Copy Error + Report Bug"
  - "Use `reportError(err, 'Context')` for async operations in event handlers and callbacks"
  - "Use `<InlineError message={msg} context={ctx} />` for data loading errors in component render"
key_points:
  - "reportError() — toast with Copy Error + Report Bug (src/renderer/lib/error-handler.ts)"
  - "InlineError — inline display with Copy Error + Report Bug (src/renderer/components/InlineError.tsx)"
  - "ErrorBoundary — full-page crash screen, wraps app root (src/renderer/components/ErrorBoundary.tsx)"
  - "createBugReport() — creates a [Bug] task with error + stack trace"
  - "Daemon errors: always pass to next(err) in Express routes; error-handler middleware returns { error, code }"
---

# Error Handling Guidelines

## Core Principle

**Every error must be visible to the user.** No error should silently disappear into `console.error` or an empty `catch` block. Users must always see a clear message and have the ability to copy the error details and report a bug.

## Three Error Display Patterns

### 1. `reportError(error, context)` — Toast Notification

**File:** `src/renderer/lib/error-handler.ts`

Use for: async operations, event handlers, callbacks, background failures.

```typescript
import { reportError } from '../lib/error-handler';

const handleSave = async () => {
  try {
    await window.api.tasks.update(id, data);
  } catch (err) {
    reportError(err, 'Save task');
  }
};
```

What the user sees:
- Toast notification (bottom-right, 8 seconds)
- Title: "Save task failed"
- Description: the error message
- **Copy Error** button — copies stack trace to clipboard
- **Report Bug** button — creates a `[Bug]` task with error + stack trace

### 2. `<InlineError>` — Inline Error Display

**File:** `src/renderer/components/InlineError.tsx`

Use for: data loading errors (useIpc hook), component-level error state rendered in the page.

```typescript
import { InlineError } from '../components/InlineError';

const { data, loading, error } = useIpc(() => window.api.tasks.list());

if (error) return <InlineError message={error} context="Task list" />;
```

What the user sees:
- Red error message inline in the page
- **Copy Error** button
- **Report Bug** button

### 3. `ErrorBoundary` — Render Crash Screen

**File:** `src/renderer/components/ErrorBoundary.tsx`

Wraps the app root. Catches React render errors automatically.

What the user sees:
- Full-page error card: "Something went wrong"
- Error message
- **Try Again** button — resets the error boundary
- **Copy Error** button
- **Report Bug** button

## Rules

### Renderer Code

1. **NEVER use bare `console.error`** — always pair with `reportError()` or set error state for `<InlineError>` rendering.

   ```typescript
   // BAD
   } catch (err) {
     console.error('Failed to save:', err);
   }

   // GOOD
   } catch (err) {
     reportError(err, 'Save task');
   }
   ```

2. **NEVER use empty `.catch(() => {})`** — at minimum report the error.

   ```typescript
   // BAD
   window.api.tasks.list().then(setTasks).catch(() => {});

   // GOOD
   window.api.tasks.list().then(setTasks).catch((err) => reportError(err, 'Load tasks'));
   ```

3. **Async operations in event handlers** — use `reportError()`.

   ```typescript
   const handleDelete = async () => {
     try {
       await window.api.tasks.delete(id);
     } catch (err) {
       reportError(err, 'Delete task');
     }
   };
   ```

4. **Data loading via useIpc** — render `<InlineError>` when error state is set.

   ```typescript
   const { data, loading, error } = useIpc(() => window.api.projects.list());
   if (error) return <InlineError message={error} context="Projects" />;
   ```

5. **Component-level error state** — use `setError` + `<InlineError>` for errors that should appear inline, and optionally also call `reportError()` for critical failures.

### Daemon / Service Code

6. **Express route handlers** — always wrap in try/catch and pass errors to `next(err)`.

   ```typescript
   router.post('/api/tasks', async (req, res, next) => {
     try {
       const task = await services.taskStore.create(req.body);
       res.json(task);
     } catch (err) { next(err); }
   });
   ```

7. **Service-level catch blocks** — log to the task event log with `category` and `severity`. Never use bare `catch {}`.

   ```typescript
   } catch (err) {
     const msg = err instanceof Error ? err.message : String(err);
     await this.taskEventLog.log({
       taskId,
       category: 'agent',
       severity: 'error',
       message: `Operation failed: ${msg}`,
     });
     throw err; // re-throw so the caller can handle it
   }
   ```

8. **`parseJson` fallbacks** — log a warning when JSON parsing fails so corrupt data is visible in logs.

### CLI Code

9. **Always set `process.exitCode = 1`** in catch blocks so shell scripts can detect failures.

## Key Files

| File | Purpose |
|------|---------|
| `src/renderer/lib/error-handler.ts` | `reportError()`, `createBugReport()`, `normalizeError()` |
| `src/renderer/components/ErrorBoundary.tsx` | React error boundary (wraps app root) |
| `src/renderer/components/InlineError.tsx` | Inline error display component |
| `src/renderer/components/ui/toaster.tsx` | Sonner toast container (bottom-right) |
| `src/daemon/middleware/error-handler.ts` | Express error middleware → `{ error, code }` |
| `src/renderer/index.tsx` | Global `window.onerror` and `unhandledrejection` handlers |
