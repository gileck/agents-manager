# Template Infrastructure

This directory contains the **reusable framework code** for the Electron macOS app template.

## ⚠️ DO NOT MODIFY

Files in this directory are framework-level infrastructure designed to work for any macOS menu bar app. Customization should be done in the `src/` directory.

## Directory Structure

```
template/
├── main/              # Main process infrastructure
├── preload/           # Preload script infrastructure (see src/preload/ for implementation)
├── renderer/          # React UI infrastructure
└── shared/            # Shared types and patterns
```

## Main Process (`main/`)

### `core/` - Application Core

**`app.ts`** - App lifecycle management
- Handles app.whenReady(), window-all-closed, before-quit events
- Manages single instance enforcement
- Provides generic initialization hooks

**`window.ts`** - Window management
- Creates and manages the BrowserWindow
- Handles window show/hide/toggle
- IPC event forwarding to renderer
- Memory leak prevention (event listener cleanup)

**`tray.ts`** - Menu bar tray icon
- Creates system tray icon
- Configurable menu building
- Standard menu template with customization

### `services/` - Infrastructure Services

**`database.ts`** - SQLite database service
- SQLite initialization with WAL mode
- Generic migration system
- Transaction-wrapped migrations
- generateId() helper
- **Electron-only:** Uses `app.getPath('userData')` to resolve the DB path. Not compatible
  with CLI or non-Electron contexts. The CLI bypasses this by passing a `db` instance
  directly to `createAppServices()`.

**`settings-service.ts`** - Key-value settings storage
- getSetting(key, defaultValue)
- setSetting(key, value)
- getAllSettingsRaw()
- deleteSetting(key)

**`log-service.ts`** - Logging service
- Buffered log writing for performance
- Automatic flushing
- Query logs by run ID
- Log cleanup utilities

**`notification.ts`** - macOS notifications
- Generic notification sending
- Support for actions and callbacks
- Navigation helpers

### `ipc/` - IPC Infrastructure

**`ipc-registry.ts`** - IPC handler registration
- registerIpcHandler() for type-safe handlers
- validateInput() for request validation
- validateId() for ID validation
- Error handling patterns

## Preload (`preload/`)

The preload directory is reserved for Electron preload script infrastructure.
The actual preload script lives in `src/preload/index.ts` and uses `ipcRenderer.invoke`
and `contextBridge.exposeInMainWorld` directly.

## Renderer (`renderer/`)

### `components/`

**`ui/`** - Shadcn UI components
- Button, Card, Input, Label, Select, Switch, Textarea, etc.
- Pre-styled, accessible components
- Tailwind CSS based

**`layout/`** - Layout components
- AppLayout - Generic app wrapper
- Sidebar - Configurable navigation sidebar

### `hooks/`

**`useTheme.ts`** - Theme management
- Light/Dark/System theme support
- Persists to settings
- CSS variable updates
- **Coupling note:** Hardcodes calls to `window.api.settings.get()` and
  `window.api.settings.update()`. The app must expose these methods via the preload bridge
  for theme persistence to work.

**`useIpc.ts`** - IPC data fetching
- Generic hook for IPC calls
- Loading and error states
- Auto-refetch

### `lib/`

**`utils.ts`** - Utility functions
- cn() for className merging
- **Note:** This file also contains app-specific helpers (cron parsing, ANSI stripping,
  path truncation) that should ideally live in `src/renderer/lib/`. Only `cn()` and
  generic formatting helpers belong in the template.

### `styles/`

**`globals.css`** - Global styles and CSS variables
- Theme color definitions
- Dark mode support
- Base styles

## Shared (`shared/`)

**`base-types.ts`** - Base framework types
- Theme type
- BaseSettings interface

**`ipc-base.ts`** - IPC patterns
- createChannel() helper
- IpcResponse type

## Usage Patterns

### UI Components

Both `template/renderer/components/ui/` and `src/renderer/components/ui/` contain Shadcn UI
components. **Always import from `src/renderer/components/ui/`** in application code. The
`src/` set is the authoritative copy and includes app-specific variants (e.g. extra Badge
colors, adjusted Card border radius, Toaster). The `template/` set is the base reference
and should not be imported directly by pages or features.

### Importing from Template

Always use the `@template` path alias:

```typescript
// Main process
import { initializeApp } from '@template/main/core/app';
import { createTray } from '@template/main/core/tray';
import { initDatabase } from '@template/main/services/database';

// Renderer
import { Button } from '@template/renderer/components/ui/button';
import { useTheme } from '@template/renderer/hooks/useTheme';
import { cn } from '@template/renderer/lib/utils';
```

### Configuring Infrastructure

The template provides configuration objects for customization:

```typescript
// App lifecycle
initializeApp({
  singleInstance: true,
  onReady: async () => { /* your init code */ },
  onBeforeQuit: () => { /* cleanup */ },
});

// Database
initDatabase({
  filename: 'your-app.db',
  migrations: yourMigrations,
});

// Tray
createTray({
  title: '🚀',
  tooltip: 'Your App',
  menuBuilder: yourMenuBuilder,
});
```

## Key Design Principles

1. **Zero App Logic** - Template code contains no app-specific logic
2. **Configuration Over Modification** - Customization via config objects, not code changes
3. **Type Safety** - Full TypeScript coverage
4. **Memory Safe** - Proper cleanup of event listeners and intervals
5. **Error Handling** - Graceful degradation and error logging

## Updating the Template

If you need to update the template infrastructure (bug fixes, new features), do it carefully:

1. Make changes in `template/` directory
2. Test with multiple apps to ensure no breaking changes
3. Document changes in this README
4. Update version in docs/CLAUDE.md

## Template Version

Current version: 1.0.0

## License

ISC
