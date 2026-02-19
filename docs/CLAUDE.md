# Electron macOS Template - Claude Code Notes

Project-specific notes and context for Claude Code.

## Project Overview

A production-ready Electron template for building macOS menu bar apps. Built with:
- **Electron 28** (downgraded from 39 for better-sqlite3 compatibility)
- **React 19** + **TypeScript**
- **Tailwind CSS** + **Shadcn-style UI components**
- **SQLite** (better-sqlite3) for persistence
- **node-cron** for task scheduling

## Commands

```bash
# Development
npm run build          # Build all (main + preload + renderer)
npm run start          # Build and run (no DevTools)
npm run start:devtools # Build and run with DevTools
npm run electron       # Run without rebuilding (no DevTools)
npm run electron:debug # Run without rebuilding (with DevTools)

# Validation
yarn checks            # Run TypeScript type-checking + ESLint (ALWAYS run after changing code)
yarn typecheck         # TypeScript only (all tsconfig projects)
yarn lint              # ESLint only

# Production / Deployment
npm run dist           # Build distributable .app bundle
npm run deploy         # Build, install to /Applications, and launch

# Watch mode
npm run dev            # Watch all three targets in parallel
```

**Important:** Always run `yarn checks` after modifying code to ensure TypeScript and lint validations pass. A pre-commit hook enforces this automatically on every commit.

## Deployment

To install the app to your Mac and add it to the Dock:

1. **First time:**
   ```bash
   npm run deploy
   ```
   Then drag your app from Applications to your Dock.

2. **After code changes:**
   ```bash
   npm run deploy
   ```
   The Dock icon automatically uses the updated version.

The deploy script (`scripts/deploy.sh`):
- Builds the app with electron-builder
- Kills any running instance
- Installs to `/Applications/`
- Launches the app

## Documentation Reference

Comprehensive implementation-grounded reference docs for each major domain:

| Document | Domain |
|----------|--------|
| [architecture-overview.md](./architecture-overview.md) | System architecture, composition root, single-execution-engine principle |
| [pipeline-engine.md](./pipeline-engine.md) | State machine, transitions, guards, hooks, seeded pipelines |
| [agent-system.md](./agent-system.md) | Agent types, execution lifecycle, prompts, validation, context accumulation |
| [task-management.md](./task-management.md) | Tasks, dependencies, subtasks, features, filtering |
| [git-scm-integration.md](./git-scm-integration.md) | Worktrees, git ops, PR lifecycle, branch strategy |
| [data-layer.md](./data-layer.md) | SQLite schema, stores, migrations |
| [workflow-service.md](./workflow-service.md) | WorkflowService orchestration, activity logging, prompt handling |
| [cli-reference.md](./cli-reference.md) | CLI tool (`am`), commands, project context |
| [ipc-and-renderer.md](./ipc-and-renderer.md) | IPC channels, renderer pages, hooks, streaming |
| [event-system.md](./event-system.md) | Events, activity log, transition history, debug timeline |

## Architecture

### Template vs Application Code

```
template/              # Framework infrastructure (DO NOT MODIFY)
├── main/core/         # App lifecycle, window, tray
├── main/services/     # Database, settings, logging, notifications
├── main/ipc/          # IPC handler registry with validation
├── preload/           # Context bridge utilities
├── renderer/          # UI components, hooks, styles
└── shared/            # Base types, IPC patterns

src/                   # Application code (CUSTOMIZE THIS)
├── main/              # App entry point, IPC handlers, migrations, services
├── preload/           # IPC API exposed to renderer
├── renderer/          # Pages, app-specific components, hooks
└── shared/            # App types, IPC channel definitions
```

### Single Execution Engine Principle

**All business logic lives in `src/main/services/` (the Electron main process).** The Electron renderer (React UI) and the CLI are **UI-only interfaces** — they display information and send commands, but NEVER contain business logic or data access code.

```
┌─────────────────────────────────────────────────┐
│  WorkflowService (the engine)                   │
│  src/main/services/                             │
│                                                 │
│  ALL features go here. All UIs consume this.    │
└──────────────┬──────────────────┬───────────────┘
               │ IPC              │ createAppServices(db)
┌──────────────┴─────┐  ┌────────┴────────────────┐
│  Electron Renderer │  │  CLI (am)                │
│  src/renderer/     │  │  src/cli/                │
│  React UI          │  │  Terminal UI             │
│  UI ONLY           │  │  UI ONLY                 │
└────────────────────┘  └─────────────────────────┘
```

Both UIs use the same `createAppServices(db)` → same WorkflowService → same SQLite file. The CLI accesses the database directly (no HTTP server or Unix socket needed). SQLite WAL mode handles concurrent access safely.

**Rules:**
- NEVER add features or logic to the renderer that belong in the main process
- The CLI uses `createAppServices(db)` to instantiate WorkflowService directly — same composition root as Electron
- All business logic lives in WorkflowService, never in CLI commands or IPC handlers
- If a feature needs to happen on task completion (e.g., writing files, sending notifications), it goes in `src/main/services/`, NOT in a UI layer

### Directory Structure

```
src/
├── main/           # Electron main process — ALL logic lives here (TypeScript → dist-main/)
├── preload/        # Context bridge (TypeScript → dist-main/preload/)
├── renderer/       # React app — UI only (TypeScript → dist/)
└── shared/         # Shared types and IPC channel definitions
```

## Key Files

| File | Purpose |
|------|---------|
| `template/main/core/app.ts` | App lifecycle, single instance lock |
| `template/main/core/window.ts` | BrowserWindow creation and management |
| `template/main/core/tray.ts` | Menu bar tray icon and context menu |
| `template/main/services/database.ts` | SQLite setup with migrations |
| `template/main/services/settings-service.ts` | Key-value settings storage |
| `template/main/services/log-service.ts` | Buffered log writing |
| `template/main/services/notification.ts` | macOS notifications |
| `template/main/ipc/ipc-registry.ts` | IPC handler registration with validation |
| `template/preload/bridge.ts` | Context bridge utilities |
| `src/main/index.ts` | App initialization |
| `src/main/ipc-handlers.ts` | IPC handler registration |
| `src/main/migrations.ts` | Database schema |
| `src/preload/index.ts` | IPC API exposed to renderer |
| `src/renderer/App.tsx` | React Router setup |

## Known Issues & Fixes

### 1. Blank/Dark Screen Fix

**Problem:** Window appears dark despite React rendering successfully.

**Solution:** Add `backgroundColor: '#ffffff'` to BrowserWindow options (already done in `template/main/core/window.ts`).

Also use inline styles as fallbacks in Layout/Sidebar components.

### 2. Electron + better-sqlite3 Compatibility

**Problem:** Electron 39+ requires C++20 for native modules, causing build failures with better-sqlite3.

**Solution:** Use Electron 28.x which has stable native module support:
```json
"electron": "^28.3.3"
```

### 3. TypeScript with SQLite

**Problem:** `db.prepare().all()` returns `unknown[]`, breaking `.map()` chains.

**Solution:** Cast the result:
```typescript
const rows = db.prepare('SELECT name FROM ...').all() as { name: string }[];
```

### 4. `crypto.randomUUID()` Not Available in Main Process

**Problem:** `crypto.randomUUID()` throws `ReferenceError: crypto is not defined` in Node.js/Electron main process.

**Solution:** Import from crypto module (already done in `template/main/services/database.ts`):
```typescript
import { randomUUID } from 'crypto';
const id = randomUUID();
```

### 5. Tray Icon Not Showing

**Problem:** File-based tray icons often fail silently on macOS.

**Solution:** Use text-based icon with `tray.setTitle()` (already done in `template/main/core/tray.ts`):
```typescript
const icon = nativeImage.createEmpty();
tray = new Tray(icon.resize({ width: 16, height: 16 }));
tray.setTitle('⚡');  // Always visible
```

### 6. Modal/Dialog Not Centered in Electron App

**Problem:** Modals using `fixed inset-0` positioning appear cut off or positioned incorrectly because they're centered relative to the viewport, which includes the native macOS title bar area.

**Solution:** Use a React Portal to render the modal inside the app's root container with `absolute` positioning instead of `fixed`:

1. Add an `id` and `relative` positioning to your Layout container:
```tsx
<div id="app-root" className="relative flex h-screen overflow-hidden">
```

2. Use `createPortal` in your Dialog component to render into `#app-root`:
```tsx
import { createPortal } from 'react-dom';

function DialogContent({ children }) {
  const appRoot = document.getElementById('app-root');
  if (!appRoot) return null;

  return createPortal(
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 bg-background rounded-lg shadow-xl">
        {children}
      </div>
    </div>,
    appRoot
  );
}
```

**Key points:**
- Use `absolute inset-0` instead of `fixed inset-0`
- Portal into the app container, not `document.body`
- The container must have `position: relative` for absolute children to work

### 7. Tailwind CSS Classes Not Working in Electron

**Problem:** Some Tailwind CSS classes don't render correctly in Electron, especially grid layouts, explicit widths, and complex background colors.

**What Does NOT Work:**
```tsx
// Grid layouts - renders as single column
<div className="grid grid-cols-4 gap-4">

// Explicit widths - ignored
<div className="w-64">
<SelectTrigger className="w-40">

// Tailwind background colors with opacity
<div className="bg-yellow-500/10">
<div className="bg-muted/50">

// Select with non-empty default - shows value instead of placeholder
<Select value={filters.type || 'all'}>
  <SelectValue placeholder="All Types" />
```

**What DOES Work:**
```tsx
// Use inline styles for layouts and widths
<div style={{ display: 'flex', gap: '16px' }}>
<div style={{ flex: 1, backgroundColor: 'rgba(234,179,8,0.1)', borderRadius: '8px', padding: '16px' }}>
<div style={{ width: '250px' }}>
<SelectTrigger style={{ width: '150px' }}>

// Use empty string for Select default so placeholder shows
<Select value={filters.type || ''}>
  <SelectValue placeholder="All Types" />
<SelectContent>
  <SelectItem value="">All Types</SelectItem>

// Basic Tailwind classes still work
<div className="flex items-center gap-3 p-6 border-b">
<div className="text-sm text-muted-foreground">
<Button className="opacity-0 group-hover:opacity-100">
```

**Best Practice:** For critical layout elements (grids, explicit widths, colored backgrounds), use inline styles. Reserve Tailwind for:
- Spacing (p-4, m-2, gap-3)
- Flexbox basics (flex, items-center, justify-between)
- Text styling (text-sm, font-bold, text-muted-foreground)
- Borders (border, border-b, rounded-lg)
- Interactive states (hover:, group-hover:)

### 8. `spawn npm ENOENT` / `spawn node ENOENT` Errors

**Problem:** Commands fail with `Error: spawn npm ENOENT` because Electron GUI apps on macOS don't inherit the user's shell PATH.

**Root Cause:**
- macOS GUI apps launch with minimal PATH (e.g., `/usr/bin:/bin:/usr/sbin:/sbin`)
- User's shell PATH (containing tools from nvm, fnm, Homebrew) is only loaded in terminal sessions
- Glob patterns like `~/.nvm/versions/node/*/bin` added as literal strings don't expand

**Solution:** Implement robust PATH resolution:

1. **Try shell methods first** (with 5s timeout):
   - User's default shell (`$SHELL -l -c "echo $PATH"`)
   - zsh with interactive flag (`/bin/zsh -li -c "echo $PATH"`)
   - bash login shell (`/bin/bash -l -c "echo $PATH"`)

2. **Validate shell results** - reject if PATH only contains system directories

3. **Fallback: Scan actual directories** for version managers:
   - nvm: `~/.nvm/versions/node/*/bin`
   - fnm: `~/.local/share/fnm/node-versions/*/installation/bin`
   - fnm aliases: `~/.local/share/fnm/aliases/*/bin`
   - volta: `~/.volta/bin`
   - asdf: `~/.asdf/installs/nodejs/*/bin`
   - Homebrew: `/opt/homebrew/bin`, `/usr/local/bin`
   - Bun: `~/.bun/bin`

4. **Use `fs.readdirSync()`** to find real version directories instead of glob patterns

```typescript
export function getUserShellPath(): string {
  // 1. Try shell methods (zsh, bash) with validation
  // 2. If all fail, scan actual directories for node versions
  // 3. Returns proper PATH with nvm, fnm, Homebrew, etc.
}

export function getShellEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: getUserShellPath(),
    HOME: homedir(),
  };
}
```

### 9. Native Module Version Mismatch (`NODE_MODULE_VERSION` Error)

**Problem:** App crashes on startup with `NODE_MODULE_VERSION` mismatch for `better-sqlite3`. All IPC handlers fail with "No handler registered" because the database can't initialize.

**Cause:** Native modules compiled for system Node.js don't match Electron's bundled Node.js. Happens after switching Node versions (nvm/fnm) or running `npm install`.

**Solution:**
```bash
npx electron-rebuild -f -w better-sqlite3
```

This template includes `electron-rebuild` as a postinstall script, so it runs automatically after `npm install`.

## Patterns & Best Practices

### Memory Leak Prevention

**Tray Update Intervals:** Always store interval references and clear them on app quit:
```typescript
let updateInterval: NodeJS.Timeout | null = null;

// Set
updateInterval = setInterval(updateTray, 5000);

// Clear on quit
app.on('before-quit', () => {
  if (updateInterval) clearInterval(updateInterval);
});
```

**Event Listener Cleanup:** Store webContents listeners as references and remove them in the 'closed' handler:
```typescript
const onNavigate = () => { /* ... */ };
window.webContents.on('did-navigate', onNavigate);

window.on('closed', () => {
  window.webContents.removeListener('did-navigate', onNavigate);
  window = null;
});
```

### Error Handling

**JSON Parse Protection:** Always wrap JSON.parse in try-catch when reading from database:
```typescript
let args: string[] = [];
try {
  args = JSON.parse(row.script_args || '[]');
} catch {
  console.error('Corrupted JSON in database:', row.script_args);
  args = [];
}
```

**Database Migration Transactions:** Wrap migrations in transactions (already done in `template/main/services/database.ts`):
```typescript
const transaction = db.transaction(() => {
  db.exec(migration.sql);
});
transaction();
```

**IPC Handler Validation:** Always validate inputs (helpers in `template/main/ipc/ipc-registry.ts`):
```typescript
registerIpcHandler('my-channel', async (_, id: string, input: MyInput) => {
  validateId(id);
  validateInput(input, ['requiredField1', 'requiredField2']);
  return myService.doSomething(id, input);
});
```

### Window Close Behavior

Use an `isQuitting` flag to distinguish between hiding and actually quitting:
```typescript
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

window.on('close', (e) => {
  if (!isQuitting) {
    e.preventDefault();
    window.hide();  // Hide instead of close
  }
});
```

### Process Tree Termination

When spawning child processes, always kill the entire process tree on stop/timeout:
```typescript
function killProcessTree(pid: number) {
  try {
    // Send SIGTERM to process group
    process.kill(-pid, 'SIGTERM');
    // Force kill after 2 seconds if still running
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch {}
    }, 2000);
  } catch {}
}
```

**Key:** Use negative PID (`-pid`) on Unix/macOS to send signals to the entire process group, not just the parent.

## Development Tips

1. **Development mode:** `npm run start` builds and runs the app, use `npm run start:devtools` for DevTools
2. **Quick restart:** After changes, just run `npm run start` again (auto-kills previous instance)
3. **Console logs:** Main process logs appear in terminal, renderer logs appear in DevTools
4. **Hot reload:** Use `npm run dev` for watch mode (separate terminal windows for main/preload/renderer)
5. **Template code:** Never modify files in `template/` — all customization goes in `src/`

## App Behavior

- **Menu bar icon:** Click to show dropdown menu (Open Dashboard, Quit, etc.)
- **Dock icon:** Click to show/open the app window
- **Window close:** Hides window but app keeps running in background
- **Quit:** Use menu bar → Quit, or Cmd+Q when window is focused

## Assets

```
assets/
├── icon.icns          # macOS app icon (generated from icon.png)
├── icon.png           # Source icon (1024x1024)
├── trayTemplate.png   # Menu bar icon (if using image-based)
└── trayTemplate@2x.png
```

## Database Location

SQLite database is stored at:
```
~/Library/Application Support/<app-name>/<db-filename>.db
```

Configure the database filename in `src/main/index.ts` via `initDatabase({ filename: 'my-app.db' })`.

## Git Ignored Files

The `.gitignore` file excludes common build artifacts and temporary files from version control:

**Build outputs:**
- `dist/`, `dist-main/` - Compiled TypeScript and bundled code
- `release/` - Electron builder output
- `build/`, `out/` - Alternative build directories

**Dependencies:**
- `node_modules/` - NPM packages (use `npm install` to restore)

**System files:**
- `.DS_Store` - macOS Finder metadata
- `Thumbs.db` - Windows thumbnail cache
- `*~` - Linux backup files

**Development tools:**
- `.claude/` - Claude Code workspace data
- `.debug/` - Debug output files
- `.vscode/`, `.idea/` - IDE settings (except shared configs)

**Environment & secrets:**
- `.env*` - Environment variable files
- `*.log` - Log files
