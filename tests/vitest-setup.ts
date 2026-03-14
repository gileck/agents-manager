/**
 * Vitest setup file — patches better-sqlite3's native binding resolution.
 *
 * Problem: better-sqlite3 ships two native bindings in this project:
 *   - build/Release/better_sqlite3.node  (Electron ABI)
 *   - build-node/Release/better_sqlite3.node  (Node.js ABI)
 *
 * When a test calls `new Database(':memory:')` without the `nativeBinding`
 * option, better-sqlite3 uses `require('bindings')` which auto-discovers
 * the Electron binding and crashes with NODE_MODULE_VERSION mismatch.
 *
 * Fix: patch the `bindings` module before any test code runs so that
 * `require('bindings')('better_sqlite3.node')` returns the Node.js addon.
 * This also populates better-sqlite3's internal DEFAULT_ADDON cache,
 * making all subsequent `new Database()` calls (with or without nativeBinding)
 * use the correct binding automatically.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DEFAULT_BINDING = 'node_modules/better-sqlite3/build-node/Release/better_sqlite3.node';
const nativeBindingPath = process.env.BETTER_SQLITE3_BINDING || DEFAULT_BINDING;

const resolvedPath = path.resolve(nativeBindingPath).replace(/(\.node)?$/, '.node');

let nodeAddon: unknown;
try {
  nodeAddon = require(resolvedPath);
} catch (err) {
  throw new Error(
    `[vitest-setup] Failed to load native binding from "${resolvedPath}" ` +
    `(BETTER_SQLITE3_BINDING="${process.env.BETTER_SQLITE3_BINDING || '(unset, using default)'}"). ` +
    `Ensure the file exists and was built for the current Node ABI. ` +
    `Try running: yarn rebuild:node\n` +
    `Original error: ${err instanceof Error ? err.message : err}`,
    { cause: err }
  );
}

const bindingsModulePath = require.resolve('bindings');
const originalBindings = require(bindingsModulePath);

const cachedModule = require.cache[bindingsModulePath];
if (!cachedModule) {
  throw new Error(
    `[vitest-setup] require.cache entry missing for 'bindings' module at "${bindingsModulePath}". ` +
    `Check for conflicting vitest plugins or ESM/CJS interop issues.`
  );
}

cachedModule.exports = function patchedBindings(opts: unknown) {
  if (typeof opts === 'string' && opts.includes('better_sqlite3')) {
    return nodeAddon;
  }
  return originalBindings(opts);
};
