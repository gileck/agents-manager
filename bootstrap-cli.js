#!/usr/bin/env node
// Use tsx to run TypeScript CLI source directly (no build step needed)
require('tsx/cjs/api').register({
  tsconfig: require('path').join(__dirname, 'config', 'tsconfig.cli.json')
});
require('./src/cli/index.ts');
