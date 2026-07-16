import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/performance/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: 120_000,
  },
});
