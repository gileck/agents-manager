# macOS Electron App Development Guide

A comprehensive guide for building macOS menu bar apps with Electron and React.

## Table of Contents
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Step-by-Step Setup](#step-by-step-setup)
- [Key Concepts](#key-concepts)
- [Common Gotchas & Solutions](#common-gotchas--solutions)
- [Packaging for Distribution](#packaging-for-distribution)
- [Tips & Best Practices](#tips--best-practices)

---

## Quick Start

```bash
# 1. Initialize project
npm init -y

# 2. Install dependencies
npm install react react-dom
npm install --save-dev electron @babel/core @babel/preset-react babel-loader \
  webpack webpack-cli html-webpack-plugin css-loader style-loader electron-builder
```

---

## Project Structure

```
my-electron-app/
├── main.js              # Electron main process
├── preload.js           # Secure bridge (main <-> renderer)
├── webpack.config.js    # Build configuration
├── package.json
├── src/
│   ├── index.html       # HTML template
│   ├── index.js         # React entry point
│   ├── App.jsx          # Main React component
│   └── App.css          # Styles
├── assets/              # Icons, images
└── dist/                # Built files (generated)
```

---

## Step-by-Step Setup

### 1. package.json

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "build": "webpack",
    "start": "npm run build && electron .",
    "pack": "npm run build && electron-builder --dir",
    "dist": "npm run build && electron-builder"
  },
  "dependencies": {
    "react": "^19.x",
    "react-dom": "^19.x"
  },
  "devDependencies": {
    "electron": "^39.x",
    "@babel/core": "^7.x",
    "@babel/preset-react": "^7.x",
    "babel-loader": "^10.x",
    "css-loader": "^7.x",
    "style-loader": "^4.x",
    "webpack": "^5.x",
    "webpack-cli": "^6.x",
    "html-webpack-plugin": "^5.x",
    "electron-builder": "^26.x"
  },
  "build": {
    "appId": "com.myapp.app",
    "productName": "My App",
    "mac": {
      "category": "public.app-category.developer-tools",
      "target": "dir"
    },
    "files": [
      "main.js",
      "preload.js",
      "dist/**/*",
      "assets/**/*"
    ]
  }
}
```

**IMPORTANT:** `electron` MUST be in `devDependencies`, not `dependencies`. electron-builder will fail otherwise.

### 2. webpack.config.js

```javascript
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-react']
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx']
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html'
    })
  ],
  devtool: 'source-map'
};
```

### 3. main.js (Electron Main Process)

```javascript
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const { exec } = require('child_process');
const path = require('path');

let tray = null;
let window = null;

function createWindow() {
  if (window) {
    window.show();
    return;
  }

  window = new BrowserWindow({
    width: 600,
    height: 500,
    show: false,
    frame: true,
    resizable: true,
    backgroundColor: '#ffffff',    // Prevents blank/dark screen
    webPreferences: {
      nodeIntegration: false,      // Security: keep false
      contextIsolation: true,       // Security: keep true
      preload: path.join(__dirname, 'preload.js')
    }
  });

  window.loadFile('dist/index.html');

  window.on('closed', () => {
    window = null;
  });

  // Hide window when it loses focus (optional, good for menu bar apps)
  window.on('blur', () => {
    if (window && !window.webContents.isDevToolsOpened()) {
      window.hide();
    }
  });

  window.once('ready-to-show', () => {
    window.show();
  });
}

function createTray() {
  // Create empty icon and use text title instead (most reliable on macOS)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  // Use a symbol as the menu bar indicator
  tray.setTitle('⌘');  // Other options: ▶, ◉, ⚡, >_

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open App',
      click: () => createWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);

  tray.setToolTip('My App');
  tray.setContextMenu(contextMenu);

  // Show menu on click (instead of opening window directly)
  tray.on('click', () => {
    tray.popUpContextMenu();
  });
}

// IPC handler for shell commands (example)
ipcMain.handle('execute-command', async (event, command) => {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: error.message, stdout: '', stderr });
        return;
      }
      resolve({ error: null, stdout, stderr });
    });
  });
});

app.whenReady().then(() => {
  createTray();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();  // Prevent app from quitting when window closes
});

// Hide from Dock (menu bar apps only)
if (app.dock) {
  app.dock.hide();
}
```

### 4. preload.js (Secure Bridge)

```javascript
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  executeCommand: (command) => ipcRenderer.invoke('execute-command', command)
  // Add more APIs as needed
});
```

### 5. src/index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

### 6. src/index.js

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### 7. src/App.jsx

```javascript
import React, { useState } from 'react';
import './App.css';

function App() {
  const [output, setOutput] = useState('');

  const runCommand = async (cmd) => {
    const result = await window.electronAPI.executeCommand(cmd);
    setOutput(result.stdout || result.error || result.stderr);
  };

  return (
    <div className="app">
      <h1>My App</h1>
      <button onClick={() => runCommand('ls')}>Run ls</button>
      <pre>{output}</pre>
    </div>
  );
}

export default App;
```

---

## Key Concepts

### Process Model

Electron has two types of processes:

1. **Main Process** (`main.js`)
   - Runs Node.js
   - Has full system access
   - Creates windows, tray, menus
   - Handles native OS operations

2. **Renderer Process** (React app)
   - Runs in Chromium
   - Sandboxed for security
   - Communicates with main via IPC

### IPC Communication

```
┌─────────────────┐         ┌─────────────────┐
│  Main Process   │◄──IPC──►│ Renderer Process│
│    (main.js)    │         │   (React App)   │
└─────────────────┘         └─────────────────┘
        │                           │
        │                           │
   preload.js (bridge)              │
        │                           │
        └───────────────────────────┘
```

**Main → Renderer:**
```javascript
// main.js
window.webContents.send('event-name', data);

// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  onEvent: (callback) => ipcRenderer.on('event-name', callback)
});
```

**Renderer → Main:**
```javascript
// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  doSomething: (arg) => ipcRenderer.invoke('do-something', arg)
});

// main.js
ipcMain.handle('do-something', async (event, arg) => {
  return result;
});
```

---

## Common Gotchas & Solutions

### 1. Tray Icon Not Showing on macOS

**Problem:** Using `nativeImage.createFromDataURL()` or file-based icons often fail silently.

**Solution:** Use `tray.setTitle()` with a text/symbol instead:
```javascript
const icon = nativeImage.createEmpty();
tray = new Tray(icon.resize({ width: 16, height: 16 }));
tray.setTitle('⌘');  // This always works!
```

### 2. electron-builder Fails with "electron in dependencies"

**Problem:**
```
Package "electron" is only allowed in "devDependencies"
```

**Solution:** Move electron to devDependencies:
```json
{
  "devDependencies": {
    "electron": "^39.x"
  }
}
```

### 3. App Quits When Window Closes

**Problem:** Closing the window quits the entire app.

**Solution:**
```javascript
app.on('window-all-closed', (e) => {
  e.preventDefault();  // Prevent quit
});
```

### 4. Window Flashes on Open

**Problem:** Window shows before content is ready.

**Solution:**
```javascript
const window = new BrowserWindow({
  show: false,  // Don't show immediately
  // ...
});

window.once('ready-to-show', () => {
  window.show();  // Show when ready
});
```

### 5. Blank/Dark Screen Despite React Rendering

**Problem:** Console logs show React components are rendering (e.g., "Layout rendering", "App mounted"), but the window displays as blank or dark.

**Symptoms:**
- DOM has content (innerHTML length > 0)
- Console shows component lifecycle logs
- No JavaScript errors
- Window appears dark/blank

**Root Cause:** The BrowserWindow doesn't have a background color set, causing a dark flash or persistent dark background before/during content load. Combined with CSS that relies on variables or Tailwind classes that may not be processed correctly.

**Solution:** Add `backgroundColor` to BrowserWindow options:
```javascript
const window = new BrowserWindow({
  width: 900,
  height: 700,
  show: false,
  backgroundColor: '#ffffff',  // <-- Critical fix!
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

**Additional defensive measures:**
1. Use inline styles as fallbacks for critical layout components:
```javascript
// Layout.tsx
<div style={{ display: 'flex', height: '100vh', background: '#f5f5f5' }}>
```

2. Ensure CSS variables have fallback values in globals.css

3. For debugging, add explicit body styles in your entry point:
```javascript
document.body.style.background = '#ffffff';
```

### 6. `app.dock.hide()` Crashes on Non-macOS

**Problem:** `app.dock` is undefined on Windows/Linux.

**Solution:**
```javascript
if (app.dock) {
  app.dock.hide();
}
```

### 7. Preload Script Path Wrong in Packaged App

**Problem:** `__dirname` points to wrong location in packaged app.

**Solution:** Use `path.join(__dirname, 'preload.js')` and ensure preload.js is in the `files` array in package.json build config.

### 8. `crypto.randomUUID()` Not Defined in Main Process

**Problem:** Using `crypto.randomUUID()` in the main process throws `ReferenceError: crypto is not defined`.

**Symptoms:**
- IPC handlers fail silently or with cryptic errors
- Task creation or other ID-generating operations fail

**Root Cause:** `crypto` is a global in browsers but must be explicitly imported in Node.js (Electron's main process).

**Solution:** Import `randomUUID` from the `crypto` module:
```javascript
// Wrong - fails in Node.js
const id = crypto.randomUUID();

// Correct - works in Node.js/Electron main process
import { randomUUID } from 'crypto';
const id = randomUUID();
```

### 9. Modal/Dialog Cut Off or Not Centered

**Problem:** Modals using CSS `fixed inset-0` positioning appear cut off at the top or positioned incorrectly in Electron apps.

**Symptoms:**
- Modal content is cut off at the top
- Modal appears higher than the visual center
- Top portion of modal is hidden behind the native title bar

**Root Cause:** CSS `fixed` positioning is relative to the viewport, but in Electron the viewport includes the native window chrome (title bar). The modal centers at 50% of the viewport height, but the visible content area starts below the title bar.

**Solution:** Use a React Portal to render the modal inside the app's root container with `absolute` positioning:

```javascript
// 1. Add id and relative positioning to your app container
// Layout.jsx
function Layout() {
  return (
    <div id="app-root" className="relative flex h-screen">
      {/* ... your app content ... */}
    </div>
  );
}

// 2. Use createPortal with absolute positioning in Dialog
// Dialog.jsx
import { createPortal } from 'react-dom';

function Dialog({ open, onClose, children }) {
  if (!open) return null;

  const appRoot = document.getElementById('app-root');
  if (!appRoot) return null;

  return createPortal(
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      {/* Modal box - centered within the app container */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-lg shadow-xl p-6">
        {children}
      </div>
    </div>,
    appRoot
  );
}
```

**Key differences from standard web approach:**
- Use `absolute inset-0` instead of `fixed inset-0`
- Portal into `#app-root` (your app container), not `document.body`
- App container must have `position: relative`
- Modal centers within the app's visible area, not the full viewport

**Why this works:** The `absolute` positioning is relative to the nearest positioned ancestor (`#app-root` with `relative`), which represents only the content area below the title bar. Flexbox centering then works correctly within this bounded area.

### 10. Tailwind CSS Classes Not Rendering Correctly

**Problem:** Tailwind CSS utility classes for grids, widths, and backgrounds don't render correctly in Electron apps.

**Symptoms:**
- Grid layouts appear as single columns
- Width classes are ignored
- Background colors with opacity don't show
- Select placeholders show the value instead of placeholder text

**What Does NOT Work:**
```jsx
// Grid - renders vertically instead of 4 columns
<div className="grid grid-cols-4 gap-4">
  <div>Card 1</div>
  <div>Card 2</div>
  <div>Card 3</div>
  <div>Card 4</div>
</div>

// Explicit widths - ignored, element stretches
<input className="w-64" />
<select className="w-40" />

// Background colors with opacity - no color appears
<div className="bg-yellow-500/10">
<div className="bg-muted/50">

// Select with non-empty default value
<Select value={value || 'all'}>
  <SelectValue placeholder="All Items" />  // Shows "all" not placeholder
</Select>
```

**What DOES Work:**
```jsx
// Flex layout with inline styles
<div style={{ display: 'flex', gap: '16px' }}>
  <div style={{ flex: 1 }}>Card 1</div>
  <div style={{ flex: 1 }}>Card 2</div>
  <div style={{ flex: 1 }}>Card 3</div>
  <div style={{ flex: 1 }}>Card 4</div>
</div>

// Explicit widths with inline styles
<div style={{ width: '250px' }}>
  <input className="pl-10" />  // Tailwind padding still works
</div>

// Background colors with rgba()
<div style={{
  backgroundColor: 'rgba(234,179,8,0.1)',  // yellow with 10% opacity
  borderRadius: '8px',
  padding: '16px'
}}>

// Select with empty string default for placeholder to show
<Select value={value || ''}>
  <SelectValue placeholder="All Items" />
  <SelectContent>
    <SelectItem value="">All Items</SelectItem>  // Use empty string
    <SelectItem value="option1">Option 1</SelectItem>
  </SelectContent>
</Select>

// Basic Tailwind classes that DO work:
<div className="flex items-center gap-3">      // Flexbox
<div className="p-6 border-b border-border">   // Padding, borders
<span className="text-sm text-muted-foreground"> // Text styling
<Button className="hover:bg-accent">           // Hover states
<div className="group">                        // Group modifier
  <button className="opacity-0 group-hover:opacity-100">  // Group hover
```

**Summary - Use Inline Styles For:**
- Grid/flex container layouts
- Explicit widths (w-64, w-40, etc.)
- Background colors, especially with opacity
- Any layout-critical styling

**Summary - Tailwind Works For:**
- Padding and margin (p-4, m-2, gap-3)
- Basic flex utilities (flex, items-center, justify-between)
- Text styling (text-sm, font-bold, text-muted-foreground)
- Borders (border, border-b, rounded-lg)
- Hover/focus states (hover:, focus:)
- Group modifiers (group, group-hover:)

### 11. `spawn npm ENOENT` / `spawn node ENOENT` on macOS

**Problem:** Spawning commands like `node`, `npm`, or `npx` fails with `ENOENT` even though they work in terminal.

**Symptoms:**
```
Error: spawn npm ENOENT
Current PATH: /usr/bin:/bin:/usr/sbin:/sbin
```

**Root Cause:** macOS GUI apps (including Electron) don't inherit the user's shell PATH. Tools installed via nvm, fnm, Homebrew, etc. aren't in the minimal system PATH.

**Solution:** Resolve the user's actual PATH before spawning processes:

```javascript
import { execSync } from 'child_process';
import { homedir } from 'os';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

function findNodeVersionPaths() {
  const paths = [];
  const home = homedir();

  // Scan nvm versions
  const nvmDir = join(home, '.nvm', 'versions', 'node');
  if (existsSync(nvmDir)) {
    for (const version of readdirSync(nvmDir)) {
      const binPath = join(nvmDir, version, 'bin');
      if (existsSync(binPath)) paths.push(binPath);
    }
  }

  // Scan fnm versions
  const fnmDir = join(home, '.local', 'share', 'fnm', 'node-versions');
  if (existsSync(fnmDir)) {
    for (const version of readdirSync(fnmDir)) {
      const binPath = join(fnmDir, version, 'installation', 'bin');
      if (existsSync(binPath)) paths.push(binPath);
    }
  }

  // Add volta, asdf, etc. as needed
  return paths;
}

function getUserShellPath() {
  // Method 1: Try to get PATH from user's shell
  try {
    const shell = process.env.SHELL || '/bin/bash';
    const result = execSync(`${shell} -l -c "echo $PATH"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim().split('\n').pop();

    // Validate it has more than system paths
    if (result && !result.match(/^\/usr\/bin:\/bin:\/usr\/sbin:\/sbin$/)) {
      return result;
    }
  } catch {}

  // Method 2: Build PATH from known locations
  const paths = new Set([
    '/opt/homebrew/bin',      // Apple Silicon Homebrew
    '/usr/local/bin',         // Intel Homebrew
    `${homedir()}/.bun/bin`,  // Bun
    ...findNodeVersionPaths(),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ]);

  return Array.from(paths).filter(p => existsSync(p)).join(':');
}

// Use when spawning processes
const proc = spawn(command, args, {
  env: {
    ...process.env,
    PATH: getUserShellPath(),
    HOME: homedir(),
  },
});
```

**Key points:**
- Don't use glob patterns (`~/.nvm/versions/node/*/bin`) - they won't expand
- Actually scan directories with `fs.readdirSync()` to find real paths
- Validate shell PATH results before using them
- Include common locations: Homebrew, nvm, fnm, volta, asdf, bun

### 12. Native Module Version Mismatch (`NODE_MODULE_VERSION` Error)

**Problem:** App crashes on startup with an error like:
```
The module 'better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 119.
```

**Symptoms:**
- App window appears but all IPC handlers fail ("No handler registered for ...")
- Database operations fail silently
- Happens after updating Node.js (e.g., via nvm) or switching Node versions

**Root Cause:** Native modules (better-sqlite3, sharp, etc.) are compiled against a specific Node.js ABI version. Electron bundles its own Node.js version which may differ from your system Node. When you run `npm install` or `yarn`, native modules get compiled for your system Node, not Electron's Node.

**Solution:**
```bash
# Rebuild native modules for the current Electron version
npx electron-rebuild -f -w better-sqlite3

# Or rebuild all native modules
npx electron-rebuild
```

**Prevention:**
- Run `npx electron-rebuild` after any `npm install` / `yarn install`
- Run it after switching Node.js versions (nvm use, fnm use, etc.)
- Add it as a postinstall script:
```json
{
  "scripts": {
    "postinstall": "electron-rebuild"
  }
}
```

---

## Packaging for Distribution

### Development Testing
```bash
npm start  # Build and run
```

### Create .app (unpacked, for testing)
```bash
npm run pack
# Output: dist/mac-arm64/My App.app
```

### Create DMG (for distribution)
```bash
npm run dist
# Output: dist/My App-1.0.0.dmg
```

### Install to Applications
```bash
cp -r "dist/mac-arm64/My App.app" /Applications/
```

### Auto-start on Login
System Settings → General → Login Items → Add your app

---

## Tips & Best Practices

### Security
- Keep `nodeIntegration: false`
- Keep `contextIsolation: true`
- Use preload.js to expose only needed APIs
- Never expose `require` or `process` to renderer

### Menu Bar Apps
- Hide dock icon: `app.dock.hide()`
- Use `tray.setTitle()` for reliable icon display
- `tray.popUpContextMenu()` on click for menu behavior
- Hide window on blur for popup-like behavior

### Performance
- Lazy-load heavy operations
- Use `show: false` + `ready-to-show` event
- Minimize IPC calls

### Debugging
```javascript
// Open DevTools
window.webContents.openDevTools();

// Log from main process
console.log('Main process log');

// Run from terminal to see all logs
./node_modules/.bin/electron .
```

### File Paths
```javascript
// In main process
const appPath = app.getAppPath();
const userDataPath = app.getPath('userData');

// For assets
path.join(__dirname, 'assets', 'icon.png')
```

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm start` | Build and run app |
| `npm run build` | Build React app only |
| `npm run pack` | Create .app bundle |
| `npm run dist` | Create distributable DMG |

---

## Useful Links

- [Electron Docs](https://www.electronjs.org/docs)
- [electron-builder Docs](https://www.electron.build/)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
