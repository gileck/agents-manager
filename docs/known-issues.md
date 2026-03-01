---
title: Known Issues & Fixes
description: Documented solutions to common Electron + React + SQLite problems in this project
summary: Ten documented issues with known fixes covering Electron rendering, SQLite compatibility, Tailwind CSS quirks, macOS PATH resolution, and native module ABI mismatches.
priority: 2
key_points:
  - "Blank screen: add backgroundColor '#ffffff' to BrowserWindow options"
  - "Tailwind grid/widths don't work in Electron — use inline styles instead"
  - "Modals: use absolute inset-0 portal into #app-root, NOT fixed inset-0"
  - "spawn ENOENT: Electron GUI apps don't inherit shell PATH — use getUserShellPath()"
  - "crypto.randomUUID(): import { randomUUID } from 'crypto' in main process"
---

# Known Issues & Fixes

## 1. Blank/Dark Screen Fix

**Problem:** Window appears dark despite React rendering successfully.

**Solution:** Add `backgroundColor: '#ffffff'` to BrowserWindow options (already done in `template/main/core/window.ts`).

Also use inline styles as fallbacks in Layout/Sidebar components.

## 2. Electron + better-sqlite3 Compatibility

**Problem:** Previously, Electron 39+ required C++20 for native modules, causing build failures with better-sqlite3.

**Solution:** Resolved in better-sqlite3 v12.6.x which includes C++20 fixes and ships prebuilt binaries for Electron 29-40+. No need to pin Electron to an old version:
```json
"electron": "^40.2.1",
"better-sqlite3": "^12.6.2"
```

## 3. TypeScript with SQLite

**Problem:** `db.prepare().all()` returns `unknown[]`, breaking `.map()` chains.

**Solution:** Cast the result:
```typescript
const rows = db.prepare('SELECT name FROM ...').all() as { name: string }[];
```

## 4. `crypto.randomUUID()` Not Available in Main Process

**Problem:** `crypto.randomUUID()` throws `ReferenceError: crypto is not defined` in Node.js/Electron main process.

**Solution:** Import from crypto module (already done in `template/main/services/database.ts`):
```typescript
import { randomUUID } from 'crypto';
const id = randomUUID();
```

## 5. Tray Icon Not Showing

**Problem:** File-based tray icons often fail silently on macOS.

**Solution:** Use text-based icon with `tray.setTitle()` (already done in `template/main/core/tray.ts`):
```typescript
const icon = nativeImage.createEmpty();
tray = new Tray(icon.resize({ width: 16, height: 16 }));
tray.setTitle('⚡');  // Always visible
```

## 6. Modal/Dialog Not Centered in Electron App

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

## 7. Tailwind CSS Classes Not Working in Electron

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

## 8. `spawn npm ENOENT` / `spawn node ENOENT` Errors

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

## 9. Native Module Version Mismatch (`NODE_MODULE_VERSION` Error)

**Problem:** `better-sqlite3` crashes with `NODE_MODULE_VERSION` mismatch because Electron and system Node need different ABI versions of the native binary.

**Solution:** The project maintains dual builds (`build/` for Electron, `build-node/` for system Node). Both are created automatically by `postinstall`. The CLI selects the correct binary via the `nativeBinding` option.

See [cli-native-bindings.md](./cli-native-bindings.md) for full details and troubleshooting.

## 10. Native Binding Not Found in Worktrees

**Problem:** When agents run in git worktrees (`.agent-worktrees/` or `.claude/worktrees/`), `better-sqlite3` fails with a `NODE_MODULE_VERSION` mismatch because `node_modules` is symlinked from the main repo and the default `build/` contains the Electron ABI binary.

**Solution:** `src/cli/db.ts` auto-resolves the `build-node/` binding via `require.resolve` — no env var needed. If you hit this error outside the CLI (e.g., ad-hoc scripts), set the env var:
```bash
export BETTER_SQLITE3_BINDING=node_modules/better-sqlite3/build-node/Release/better_sqlite3.node
```
