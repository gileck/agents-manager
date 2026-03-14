#!/usr/bin/env node
// Checks that the better-sqlite3 build-node binary matches the current Node ABI.
// If not, triggers a rebuild. Used as a pre-step for dev:start and test scripts.

const path = require('path');
const { execSync } = require('child_process');

const bindingPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'better-sqlite3',
  'build-node',
  'Release',
  'better_sqlite3.node'
);

try {
  require(bindingPath);
} catch (err) {
  if (err.code === 'ERR_DLOPEN_FAILED' && err.message.includes('NODE_MODULE_VERSION')) {
    console.log('[ensure-native-binding] build-node binary was compiled for a different Node version. Rebuilding...');
    execSync('npm run rebuild:node', { stdio: 'inherit' });
    console.log('[ensure-native-binding] Rebuild complete.');
  } else {
    throw err;
  }
}
