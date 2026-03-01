# Coupling Analysis: src/main/ Electron Dependencies

Audit performed to identify every file in `src/main/` that imports from `electron` or `@template/*`.

## Summary

- **Total files in `src/main/`:** ~128
- **Files with `@template/*` imports:** ~20 (12 in `ipc-handlers/`, 3 in `services/`, plus `index.ts`, `providers/setup.ts`, `migrations.ts`, `desktop-notification-router.ts`)
- **Files with `electron` imports:** 4 (`index.ts`, `ipc-handlers/index.ts`, `ipc-handlers/shell-handlers.ts`, `ipc-handlers/telegram-handlers.ts`)
- **Files that are pure business logic with leaking imports:** 4 (items 1–4 below)
- **Files that are correctly Electron-only:** IPC handlers directory (13 files), `index.ts`, `desktop-notification-router.ts`

**Note:** The IPC handlers are split into 13 domain-scoped files under `src/main/ipc-handlers/` (not a single `ipc-handlers.ts` file). All of them are correctly Electron-only.

## Detailed Findings

### 1. `src/main/handlers/agent-handler.ts` (BUSINESS LOGIC)

**Imports:**
```typescript
import { IPC_CHANNELS } from '../../shared/ipc-channels';
const { sendToRenderer } = require('@template/main/core/window');  // dynamic require
```

**Why it leaks:** This is a pipeline hook (pure business logic) that directly calls `sendToRenderer()` to stream agent output, messages, and status to the Electron renderer. It should not know about the renderer at all.

**Fix:** Make streaming callbacks injectable via `AgentHandlerDeps`. The composition root passes an Electron-specific factory in GUI mode; CLI mode passes nothing (no-op fallback).

---

### 2. `src/main/services/telegram-bot-service.ts` (BUSINESS LOGIC)

**Imports:**
```typescript
import { getSetting } from '@template/main/services/settings-service';
```

**Why it leaks:** The `handleCreateTask` method calls `getSetting('default_pipeline_id', '')` to determine which pipeline to use for new tasks created via Telegram. This ties a core service to the Electron settings system.

**Fix:** Accept `defaultPipelineId` as a constructor parameter or method argument instead of reading it from the Electron settings service.

---

### 3. `src/main/services/item-service.ts` (BUSINESS LOGIC)

**Imports:**
```typescript
import { getDatabase, generateId } from '@template/main/services/database';
```

**Why it leaks:** Uses the Electron template's global database singleton instead of receiving `db` as a parameter like every other store in the codebase.

**Fix:** Accept `db: Database.Database` as a parameter for each function, matching the pattern used by all SQLite stores. Replace `generateId()` with `crypto.randomUUID()`.

---

### 4. `src/main/migrations.ts` (BUSINESS LOGIC)

**Imports:**
```typescript
import type { Migration } from '@template/main/services/database';
```

**Why it leaks:** Imports a type definition from the Electron template. The type is trivial: `{ name: string; sql: string }`.

**Fix:** Define the `Migration` type locally (inline or in `src/shared/types.ts`).

---

### 5. `src/main/index.ts` (CORRECTLY ELECTRON-ONLY)

**Imports:**
```typescript
import { app, Tray } from 'electron';
import { initializeApp } from '@template/main/core/app';
import { createTray, buildStandardMenu } from '@template/main/core/tray';
import { sendToRenderer } from '@template/main/core/window';
import { initDatabase, closeDatabase, getDatabase } from '@template/main/services/database';
```

**Status:** This is the Electron entry point. It initializes the app, database, services, tray, and supervisors. Correctly placed — stays in `src/main/`.

---

### 6. `src/main/ipc-handlers/` (CORRECTLY ELECTRON-ONLY — 13 files)

The IPC handlers are split into domain-scoped files:

| File | Imports from |
|------|-------------|
| `index.ts` | `electron`, `@template/main/ipc/ipc-registry`, `@template/main/core/window`, `@template/main/services/settings-service` |
| `agent-handlers.ts` | `@template/main/ipc/ipc-registry`, `@template/main/core/window` |
| `agent-def-handlers.ts` | `@template/main/ipc/ipc-registry` |
| `chat-session-handlers.ts` | `@template/main/ipc/ipc-registry`, `@template/main/core/window` |
| `feature-handlers.ts` | `@template/main/ipc/ipc-registry` |
| `git-handlers.ts` | `@template/main/ipc/ipc-registry` |
| `kanban-handlers.ts` | `@template/main/ipc/ipc-registry` |
| `pipeline-handlers.ts` | `@template/main/ipc/ipc-registry` |
| `project-handlers.ts` | `@template/main/ipc/ipc-registry` |
| `settings-handlers.ts` | `@template/main/ipc/ipc-registry`, `@template/main/services/settings-service` |
| `shell-handlers.ts` | `electron`, `@template/main/ipc/ipc-registry` |
| `task-handlers.ts` | `@template/main/ipc/ipc-registry` |
| `telegram-handlers.ts` | `electron`, `@template/main/ipc/ipc-registry`, `@template/main/core/window` |

**Status:** All are pure IPC bridges — validate inputs, delegate to services, stream responses. Correctly placed — all stay in `src/main/ipc-handlers/`.

**Note:** The `AGENT_SEND_MESSAGE` handler in `agent-handlers.ts` correctly delegates to `workflowService.resumeAgent()` — it does not contain leaked business logic. The streaming callbacks (`sendToRenderer`) in agent-handlers, chat-session-handlers, and telegram-handlers are correctly Electron-only and will be replaced with API client calls in PR 4.

---

### 7. `src/main/services/desktop-notification-router.ts` (CORRECTLY ELECTRON-ONLY)

**Imports:**
```typescript
import { sendNotification } from '@template/main/services/notification';
import { showWindow, sendToRenderer } from '@template/main/core/window';
```

**Status:** Electron-specific notification sender. Stays in `src/main/`.

---

### 8. ~~`src/main/services/electron-notification-router.ts`~~ (DOES NOT EXIST)

This file was referenced in earlier analysis but does not exist in the codebase. The only Electron-specific notification routers are:
- `desktop-notification-router.ts` (item 7 above — actively used via dynamic require in `setup.ts`)
- `telegram-notification-router.ts` (pure business logic, no Electron imports — will move to `src/core/`)
- `multi-channel-notification-router.ts` (pure business logic — will move to `src/core/`)
- `stub-notification-router.ts` (test utility — will move to `src/core/`)

---

## External Consumers of `src/main/`

### CLI (`src/cli/`)

The CLI imports from `src/main/` in 3 files:

| File | Import |
|------|--------|
| `src/cli/db.ts` | `getMigrations` from `../main/migrations`, `createAppServices` from `../main/providers/setup` |
| `src/cli/index.ts` | `AppServices` type from `../main/providers/setup` |
| `src/cli/context.ts` | `AppServices` type from `../main/providers/setup` |

After the move to `src/core/`, these paths change from `../main/` to `../core/`.

### Tests (`tests/`)

- **31 test files** import from `src/main/`
- **91 total import statements** reference `../../src/main/`
- `tests/helpers/test-context.ts` has **44 imports** (most affected single file)

After the move, all `../../src/main/` paths become `../../src/core/`.

## The `setup.ts` Dynamic Require

`src/main/providers/setup.ts` (line 131-134) uses a try/require for `DesktopNotificationRouter`:

```typescript
try {
  const { DesktopNotificationRouter } = require('../services/desktop-notification-router');
  notificationRouter.addRouter(new DesktopNotificationRouter());
} catch { /* Not in Electron */ }
```

After the file moves to `src/core/providers/setup.ts`, the relative path `../../main/services/desktop-notification-router` would still resolve correctly at runtime (the file still exists in `src/main/`). However, this would **violate the architectural constraint** that `src/core/` must never import from `src/main/` — the problem is an architectural boundary violation, not a runtime break.

The recommended fix is to make this pluggable via the `AppServicesConfig` interface so `setup.ts` has zero knowledge of the Electron notification router. The Electron entry point passes it in; the CLI and daemon don't.

## Build Configuration Impact

### `config/tsconfig.main.json`
Currently includes: `"../src/main/**/*"`, `"../src/shared/**/*"`, `"../template/main/**/*"`, `"../template/shared/**/*"`
Must add: `"../src/core/**/*"`

### `config/tsconfig.cli.json`
Currently includes: `"../src/cli/**/*"`, `"../src/main/**/*"`, `"../src/shared/**/*"`, `"../template/main/**/*"`, `"../template/shared/**/*"`
Must add: `"../src/core/**/*"`
Can remove `"../src/main/**/*"` if CLI no longer imports from main (it won't after PR 2).

### `tsconfig.json` (root)
Current path aliases:
```json
{
  "@shared/*": ["src/shared/*"],
  "@template/*": ["template/*"],
  "@/*": ["template/renderer/*"]
}
```
Optional: add `"@core/*": ["src/core/*"]` for convenience.

### `vitest.config.ts`
Current aliases: `@shared`, `@template`
Optional: add `@core` alias if path alias is added to tsconfig.
