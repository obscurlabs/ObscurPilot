import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/chaos/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 60_000,
  },
});
