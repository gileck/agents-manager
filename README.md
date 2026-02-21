# MacOS Electron App Template

A production-ready Electron template for building macOS menu bar applications with React, TypeScript, and a modern UI.

## Features

- **🎨 Modern UI Stack**
  - React 19 + TypeScript
  - Tailwind CSS + Shadcn-style components
  - Dark/Light/System theme support

- **🏗️ Template Architecture**
  - Separation of framework (`template/`) and app code (`src/`)
  - Reusable infrastructure for window, tray, database, settings
  - Type-safe IPC communication

- **💾 Built-in Services**
  - SQLite database with migrations (better-sqlite3)
  - Settings persistence
  - Logging service
  - Notification service

- **📦 Ready to Deploy**
  - electron-builder configuration
  - One-command deployment to /Applications
  - Menu bar app behavior (stays in background)

## Quick Start

```bash
# Clone or download this template
git clone <your-repo-url>
cd electron-macos-template

# Install dependencies
yarn install

# Build and run
yarn start

# Run with DevTools
yarn start:devtools

# Build for production
yarn dist

# Deploy to /Applications and launch
yarn deploy
```

## Project Structure

```
electron-macos-template/
├── template/                    # 🔧 Reusable framework (DO NOT MODIFY)
│   ├── main/
│   │   ├── core/               # App lifecycle, window, tray
│   │   ├── services/           # Database, settings, notifications, logging
│   │   └── ipc/                # IPC registry and validation
│   ├── preload/                # Context bridge utilities
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── ui/            # Shadcn UI components
│   │   │   └── layout/        # AppLayout, Sidebar
│   │   ├── hooks/             # useTheme, useIpc
│   │   ├── lib/               # utils
│   │   └── styles/            # Global CSS
│   └── shared/                 # Base types, IPC patterns
│
├── src/                        # 📝 Your app code (CUSTOMIZE THIS)
│   ├── main/
│   │   ├── index.ts           # App initialization
│   │   ├── ipc-handlers.ts    # IPC handler registration
│   │   ├── migrations.ts      # Database migrations
│   │   └── services/          # App-specific services (e.g., item-service)
│   ├── preload/
│   │   └── index.ts           # IPC API definition
│   ├── renderer/
│   │   ├── components/        # App-specific components
│   │   │   └── layout/        # Layout, Sidebar (uses template)
│   │   ├── pages/             # Your app pages
│   │   ├── hooks/             # App-specific hooks
│   │   └── App.tsx            # Router configuration
│   └── shared/
│       ├── types.ts           # App types
│       └── ipc-channels.ts    # IPC channel names
│
├── assets/                     # App icons
├── bootstrap.js               # Path alias registration
├── tsconfig.*.json            # TypeScript configurations
├── webpack.renderer.config.js # Webpack config
└── package.json               # Project metadata
```

## Example App: Items CRUD

This template includes a simple example app for managing items (create, read, update, delete). It demonstrates:

- Database operations with migrations
- IPC communication between main and renderer
- CRUD UI with forms and lists
- Settings management
- Theme switching

### Pages
- **Home** (`/`) - Welcome page with item count
- **Items** (`/items`) - List all items
- **New/Edit Item** (`/items/new`, `/items/:id/edit`) - Form for creating/editing
- **Settings** (`/settings`) - Theme and preferences

## Customization Guide

See [TEMPLATE.md](./docs/TEMPLATE.md) for detailed instructions on:
- Understanding template/ vs src/ separation
- Adding new features
- Creating database tables
- Adding IPC handlers
- Creating new pages
- Syncing template updates

## Available Commands

```bash
# Development
yarn build          # Build all (main + preload + renderer)
yarn start          # Build and run (no DevTools)
yarn start:devtools # Build and run with DevTools
yarn electron       # Run without rebuilding (no DevTools)
yarn electron:debug # Run without rebuilding (with DevTools)
yarn dev            # Watch mode (3 terminals: main, preload, renderer)

# Production
yarn dist           # Build distributable .app bundle
yarn deploy         # Build, install to /Applications, and launch
yarn pack           # Build without packaging (for testing)
```

## Tech Stack

- **Electron 40** - Native desktop app framework
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS
- **better-sqlite3** - SQLite database
- **Webpack** - Module bundler
- **electron-builder** - App packaging

## Database

SQLite database is stored at:
```
~/Library/Application Support/electron-macos-template/app.db
```

Migrations are defined in `src/main/migrations.ts` and run automatically on app start.

## Menu Bar Behavior

This template creates a **menu bar app**:
- Tray icon appears in menu bar (📝)
- Clicking the X button **hides** the window (app keeps running)
- App continues running in background
- Use tray menu → Quit or Cmd+Q to fully quit

To show the app in the Dock (for Cmd+Tab switching), the app is visible by default. To hide it:
```typescript
// In src/main/index.ts, add this in onReady:
app.dock?.hide();
```

## Build & Deploy

### First Time Setup
```bash
yarn deploy
```
Then drag the app from Applications to your Dock.

### After Code Changes
```bash
yarn deploy
```
The Dock icon automatically uses the updated version.

## Troubleshooting

### Build fails with TypeScript errors
Remove `rootDir` from tsconfig if you see errors about files not being under rootDir.

### App doesn't launch
Check for errors in the terminal. Common issues:
- Missing dependencies: `yarn install`
- Better-sqlite3 not rebuilt: `yarn postinstall`

### Dark mode not working
Make sure theme is set in Settings. The template uses CSS variables that adapt to the theme.

## License

ISC

## Contributing

This template is designed to be copied and customized. Feel free to modify it for your needs!

For questions or issues, please open an issue on GitHub.
# agents-manager
