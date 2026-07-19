import { defineConfig } from '@playwright/test';

const durationMinutes = Number(process.env.OBSCURPILOT_SOAK_MINUTES ?? 480);

export default defineConfig({
  testDir: '.',
  testMatch: 'stage13-desktop-soak.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: Math.ceil(durationMinutes * 60_000) + 120_000,
  use: { trace: 'retain-on-failure' },
});
