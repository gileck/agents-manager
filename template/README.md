# Template Infrastructure

This directory contains the **reusable framework code** for the Electron macOS app template.

## ⚠️ DO NOT MODIFY

Files in this directory are framework-level infrastructure designed to work for any macOS menu bar app. Customization should be done in the `src/` directory.

## Directory Structure

```
template/
├── main/              # Main process infrastructure
├── preload/           # Preload script utilities
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

**`bridge.ts`** - Context bridge utilities
- createInvokeHandler() for IPC invoke wrappers
- createEventListener() for main → renderer events
- exposeBridge() for API exposure

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

**`useIpc.ts`** - IPC data fetching
- Generic hook for IPC calls
- Loading and error states
- Auto-refetch

### `lib/`

**`utils.ts`** - Utility functions
- cn() for className merging
- Other helpers

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
