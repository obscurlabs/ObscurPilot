import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/chaos/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: 60_000,
  },
});
