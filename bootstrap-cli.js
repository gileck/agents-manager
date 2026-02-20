#!/usr/bin/env node
// Redirect better-sqlite3 to the Node-compatible build (build-node/) instead
// of the Electron-compiled build (build/). Run `npm run rebuild:node` once to
// create the build-node/ directory.
const path = require('path');
const fs = require('fs');
const nodeBinding = path.join(__dirname, 'node_modules', 'better-sqlite3', 'build-node', 'Release', 'better_sqlite3.node');
if (fs.existsSync(nodeBinding)) {
  process.env.BETTER_SQLITE3_BINDING = nodeBinding;
}

// Use tsx to run TypeScript CLI source directly (no build step needed)
require('tsx/cjs/api').register({
  tsconfig: path.join(__dirname, 'config', 'tsconfig.cli.json')
});
require('./src/cli/index.ts');
