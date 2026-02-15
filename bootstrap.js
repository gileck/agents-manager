// Register runtime path aliases for compiled code
const tsConfigPaths = require('tsconfig-paths');
const path = require('path');

// Register paths manually for runtime (pointing to compiled output)
tsConfigPaths.register({
  baseUrl: path.join(__dirname, 'dist-main'),
  paths: {
    '@shared/*': ['shared/*'],
    '@template/*': ['template/*']
  }
});

// Load the main entry point
require('./dist-main/src/main/index.js');
