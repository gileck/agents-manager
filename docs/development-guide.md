---
title: Development Guide
description: Package manager, commands, deployment, dev tips, app behavior, assets, and key files
summary: Always use yarn (never npm). Run yarn checks after every code change. Use yarn start to build and run, yarn deploy to install to /Applications.
priority: 1
guidelines:
  - "ALWAYS use `yarn` as the package manager — NEVER use `npm`"
  - "ALWAYS run `yarn checks` after modifying code (TypeScript + ESLint)"
  - "Never modify files in `template/` — all customization goes in `src/`"
key_points:
  - "yarn start — build and run (no DevTools)"
  - "yarn start:devtools — build and run with DevTools"
  - "yarn checks — typecheck + lint (run after every change)"
  - "yarn deploy — build, install to /Applications, and launch"
  - "yarn dev — watch mode for all three targets in parallel"
---

# Development Guide

## Package Manager

**Always use `yarn` as the package manager. Never use `npm`.**

## Commands

```bash
# Development
yarn build             # Build all (main + preload + renderer)
yarn start             # Build and run (no DevTools)
yarn start:devtools    # Build and run with DevTools
yarn electron          # Run without rebuilding (no DevTools)
yarn electron:debug    # Run without rebuilding (with DevTools)

# Validation
yarn checks            # Run TypeScript type-checking + ESLint (ALWAYS run after changing code)
yarn typecheck         # TypeScript only (all tsconfig projects)
yarn lint              # ESLint only

# Production / Deployment
yarn dist              # Build distributable .app bundle
yarn deploy            # Build, install to /Applications, and launch

# Watch mode
yarn dev               # Watch all three targets in parallel
```

**Important:** Always run `yarn checks` after modifying code to ensure TypeScript and lint validations pass. A pre-commit hook enforces this automatically on every commit.

## Deployment

To install the app to your Mac and add it to the Dock:

1. **First time:**
   ```bash
   yarn deploy
   ```
   Then drag your app from Applications to your Dock.

2. **After code changes:**
   ```bash
   yarn deploy
   ```
   The Dock icon automatically uses the updated version.

The deploy script (`scripts/deploy.sh`):
- Builds the app with electron-builder
- Kills any running instance
- Installs to `/Applications/`
- Launches the app

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

## Development Tips

1. **Development mode:** `yarn start` builds and runs the app, use `yarn start:devtools` for DevTools
2. **Quick restart:** After changes, just run `yarn start` again (auto-kills previous instance)
3. **Console logs:** Main process logs appear in terminal, renderer logs appear in DevTools
4. **Hot reload:** Use `yarn dev` for watch mode (separate terminal windows for main/preload/renderer)
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
- `node_modules/` - Packages (use `yarn install` to restore)

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
