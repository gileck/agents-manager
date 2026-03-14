import { defineConfig } from 'vitest/config';
import path from 'path';
import { builtinModules } from 'module';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/agent-lib-e2e.test.ts', 'tests/e2e/cli-subprocess.test.ts'],
    setupFiles: ['./tests/vitest-setup.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/renderer/**', 'src/preload/**', 'src/main/index.ts'],
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    alias: [
      { find: '@shared', replacement: path.resolve(__dirname, 'src/shared') },
      { find: '@core', replacement: path.resolve(__dirname, 'src/core') },
      { find: '@template', replacement: path.resolve(__dirname, 'template') },
      ...builtinModules.map((mod) => ({
        find: mod,
        replacement: `node:${mod}`,
      })),
    ],
  },
});
