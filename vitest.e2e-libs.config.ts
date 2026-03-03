import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/agent-lib-e2e.test.ts'],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@template': path.resolve(__dirname, 'template'),
    },
  },
});
