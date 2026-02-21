# CLI Native Bindings (Electron + Node Coexistence)

## Problem

The project runs in two runtimes:
- **Electron** (main app) — uses its own Node ABI
- **System Node** (CLI, tests, agents in worktrees) — uses a different ABI

`better-sqlite3` is a native module that must be compiled for a specific Node ABI. A single binary can't serve both runtimes.

## Solution: Dual Builds

Two builds of the native module coexist inside `node_modules/better-sqlite3/`:

| Directory | Runtime | Created by |
|-----------|---------|------------|
| `build/` | Electron | `@electron/rebuild` (postinstall) |
| `build-node/` | System Node | `npm run rebuild:node` (postinstall) |

Both are created automatically during `npm install` / `yarn` via the `postinstall` script:

```
"postinstall": "npx @electron/rebuild -f -w better-sqlite3 && npm run rebuild:node"
```

Since better-sqlite3 v12.6.x ships prebuilt binaries for both Electron and Node, this downloads precompiled binaries rather than compiling from source — making installs fast and reliable.

### How `rebuild:node` works

```bash
cd node_modules/better-sqlite3
rm -rf build-node
mv build build-electron-bak    # save Electron build
npx prebuild-install -r node   # download Node-compatible prebuilt into build/
mv build build-node             # move to build-node/
mv build-electron-bak build     # restore Electron build
```

### How the CLI and tests select the right binary

1. `bootstrap-cli.js` checks if `build-node/` exists and sets `BETTER_SQLITE3_BINDING` env var
2. `src/cli/db.ts` reads the env var and passes it as `nativeBinding` option to `better-sqlite3`
3. Test scripts set `BETTER_SQLITE3_BINDING` in the environment so tests use the Node binary
4. The Electron app ignores this — it loads from `build/` as usual

No directory swapping is needed — both builds coexist permanently and the correct one is selected via the `nativeBinding` option.

## Worktree Support

Git worktrees don't include `node_modules` (it's untracked). `LocalWorktreeManager.create()` automatically symlinks `node_modules` from the main project into new worktrees, so agents can run:

```bash
npx agents-manager tasks list
npx agents-manager tasks subtask update <id> --name "..." --status in_progress
```

The symlink means worktrees share both `build/` and `build-node/` from the main project.

## Commands

| Command | Effect |
|---------|--------|
| `yarn` / `npm install` | Builds both Electron and Node binaries automatically |
| `npm run rebuild:electron` | Rebuilds `build/` for Electron only |
| `npm run rebuild:node` | Rebuilds `build-node/` for system Node only |
| `yarn start` | Runs `rebuild:electron` first, safe to run anytime |

## Troubleshooting

**CLI fails with `NODE_MODULE_VERSION` error:**
```bash
npm run rebuild:node
```

**Electron app fails with `NODE_MODULE_VERSION` error:**
```bash
npm run rebuild:electron
```

**Both fail after switching Node versions (nvm/fnm):**
```bash
yarn  # postinstall rebuilds both
```
