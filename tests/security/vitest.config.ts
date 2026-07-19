import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/security/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: 120_000,
  },
});
