#!/usr/bin/env node
// Register runtime path aliases for compiled CLI code
const tsConfigPaths = require('tsconfig-paths');
const path = require('path');

tsConfigPaths.register({
  baseUrl: path.join(__dirname, 'dist-cli'),
  paths: {
    '@shared/*': ['src/shared/*'],
    '@template/*': ['template/*']
  }
});

// Load the CLI entry point
require('./dist-cli/src/cli/index.js');
