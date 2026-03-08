---
title: Web UI
description: Browser-based UI client sharing the same React renderer as Electron
summary: "The web UI serves the same React app as Electron but runs in a standard browser. The API shim replaces the Electron preload bridge with direct HTTP + browser WebSocket to the daemon."
priority: 2
key_points:
  - "Web entry point: src/web/index.tsx — installs API shim, mounts same <App/> as Electron"
  - "API shim (src/web/api-shim.ts) implements ApiShape using ApiClient (HTTP) + browser WebSocket"
  - "Shared type: src/shared/api-shape.ts — single source of truth for window.api surface"
  - "Build: `yarn build:web` → dist-web/ — daemon serves it at http://localhost:3847"
  - "Shell operations (iTerm, VS Code, Chrome) work via daemon REST endpoints, not Electron IPC"
  - "All renderer code (src/renderer/) is shared — zero Electron imports"
---

# Web UI

The web UI is a browser-based client that shares the exact same React renderer as the Electron app. It connects directly to the daemon's HTTP and WebSocket APIs, bypassing Electron's IPC layer entirely.

## Architecture

```
Electron path:
  renderer → window.api (preload/ipcRenderer) → IPC → main process → daemon HTTP/WS

Web path:
  renderer → window.api (api-shim/fetch+WebSocket) → daemon HTTP/WS
```

Both paths serve the identical React UI from `src/renderer/`. The difference is how `window.api` is populated:

| | Electron | Web |
|---|---|---|
| Data operations | `ipcRenderer.invoke()` → IPC → `ApiClient` | `ApiClient` directly (fetch) |
| Push events | daemon WS → Node ws-client → `sendToRenderer()` → `ipcRenderer.on()` | Browser `WebSocket` directly |
| Shell operations | Electron main process (pre-Phase 1) / daemon REST (post-Phase 1) | Daemon REST |

## Key Files

| File | Purpose |
|---|---|
| `src/web/index.tsx` | Web entry point — installs shim, mounts `<App/>` with HashRouter |
| `src/web/api-shim.ts` | Implements `ApiShape` using `ApiClient` + browser WebSocket |
| `src/web/ws-browser-client.ts` | Browser-native WebSocket client with auto-reconnect |
| `src/web/index.html` | Minimal HTML template (no Electron CSP) |
| `src/shared/api-shape.ts` | Shared TypeScript interface for `window.api` |
| `src/daemon/routes/shell.ts` | Shell operations as daemon REST endpoints |
| `config/webpack.web.config.js` | Webpack config for web build |
| `config/tsconfig.web.json` | TypeScript config for web project |

## Building and Running

```bash
# Build the web UI
yarn build:web

# Build daemon (serves the web bundle)
yarn build:daemon

# Start daemon (serves web UI at http://localhost:3847)
node dist-daemon/index.js

# Development with watch mode
yarn dev:web     # watches src/web + src/renderer for changes
```

The daemon automatically serves the web bundle from `dist-web/` if that directory exists. Open `http://localhost:3847` in any browser.

## How the API Shim Works

The shim (`src/web/api-shim.ts`) creates a `window.api` object that matches the exact same `ApiShape` interface as the Electron preload bridge. It:

1. Creates an `ApiClient` (pure HTTP fetch client) pointed at the daemon URL
2. Creates a browser WebSocket client connected to `ws://host:3847/ws`
3. Maps every `window.api.*` call to the corresponding `ApiClient` method
4. Maps every `window.api.on.*` listener to a WebSocket channel subscription

### Signature Mapping

Some method signatures differ between `ApiShape` (renderer-facing) and `ApiClient` (daemon-facing). The shim handles these:

- `git.diff(taskId)` returns `string | null` but ApiClient returns `{ diff: string } | null` → shim unwraps
- `git.branch(projectId)` returns `string` but ApiClient returns `{ branch: string }` → shim unwraps
- `agents.stop(runId)` takes one arg but ApiClient takes `(taskId, runId)` → shim passes `'_'` as taskId
- Method name differences: `activeRuns` → `getActiveRuns`, `allRuns` → `getAllRuns`, etc.

## Shell Operations

Shell operations (open iTerm, VS Code, Chrome, folder picker) run on the daemon process, not in the browser. This works because:

- The daemon runs locally on the developer's machine
- It has full OS access (child_process, osascript, etc.)
- The web client calls daemon REST endpoints (e.g., `POST /api/shell/open-in-iterm`)

| Endpoint | Action |
|---|---|
| `POST /api/shell/open-in-chrome` | Opens URL in Chrome via `open -a` |
| `POST /api/shell/open-in-iterm` | Opens iTerm at path via AppleScript |
| `POST /api/shell/open-in-vscode` | Opens VS Code at path via `code` CLI |
| `POST /api/shell/open-file-in-vscode` | Opens file at line in VS Code |
| `GET /api/shell/pick-folder` | Shows macOS folder picker via osascript |
| `GET /api/app/version` | Returns app version from package.json |

## TypeScript Configuration

The web project uses `config/tsconfig.web.json` which includes:
- `src/web/**/*` — web-specific files
- `src/renderer/**/*` — shared React UI
- `src/shared/**/*` — shared types and utils
- `src/client/api-client.ts` — HTTP client
- `src/daemon/ws/channels.ts` — WS channel constants

Run `yarn typecheck:web` to check web-specific types, or `yarn checks` to check all projects including web.
