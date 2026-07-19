import { _electron as electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

interface Sample {
  readonly rss: number;
  readonly heapUsed: number;
  readonly resources: number;
  readonly windows: number;
}

const enabled = process.env.OBSCURPILOT_STAGE13_SOAK === '1';
const durationMs = Number(process.env.OBSCURPILOT_SOAK_MINUTES ?? 480) * 60_000;
const sampleMs = Number(process.env.OBSCURPILOT_SOAK_SAMPLE_MS ?? 15_000);

test('desktop remains bounded and responsive for the configured Stage 13 duration', async () => {
  test.skip(!enabled, 'Use npm run test:soak or npm run test:soak:smoke');
  expect(durationMs).toBeGreaterThanOrEqual(10_000);
  expect(sampleMs).toBeGreaterThanOrEqual(1_000);

  const require = createRequire(import.meta.url);
  const electronPath: unknown = require('electron');
  if (typeof electronPath !== 'string') throw new Error('Pinned Electron executable unavailable');
  const application = await electron.launch({
    executablePath: electronPath,
    args: [resolve('apps/desktop')],
    env: { ...process.env, OBSCURPILOT_E2E: '1' },
  });
  const samples: Sample[] = [];
  let rendererCrashes = 0;
  let snapshotFailures = 0;

  try {
    await application.firstWindow();
    const page = application.windows().find((candidate) => candidate.url().endsWith('/index.html'));
    if (page === undefined) throw new Error('Control board window was not created');
    page.on('crash', () => {
      rendererCrashes += 1;
    });
    await expect(page).toHaveTitle('ObscurPilot');

    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      try {
        await page.evaluate(async () => {
          const api = (
            globalThis as typeof globalThis & {
              obscurPilot?: { getSnapshot(): Promise<unknown> };
            }
          ).obscurPilot;
          if (api === undefined) throw new Error('Narrow preload API is unavailable');
          await api.getSnapshot();
        });
      } catch {
        snapshotFailures += 1;
      }
      samples.push(
        await application.evaluate(({ BrowserWindow }) => ({
          rss: process.memoryUsage().rss,
          heapUsed: process.memoryUsage().heapUsed,
          resources: process.getActiveResourcesInfo().length,
          windows: BrowserWindow.getAllWindows().length,
        })),
      );
      await page.waitForTimeout(
        Math.min(sampleMs, Math.max(1, durationMs - (Date.now() - startedAt))),
      );
    }
  } finally {
    await application.close();
  }

  expect(samples.length).toBeGreaterThanOrEqual(5);
  const warmup = samples.slice(0, Math.min(3, samples.length));
  const tail = samples.slice(-Math.min(3, samples.length));
  const baselineRss = Math.max(...warmup.map((sample) => sample.rss));
  const baselineHeap = Math.max(...warmup.map((sample) => sample.heapUsed));
  const baselineResources = Math.max(...warmup.map((sample) => sample.resources));
  const tailRss = Math.max(...tail.map((sample) => sample.rss));
  const tailHeap = Math.max(...tail.map((sample) => sample.heapUsed));
  const tailResources = Math.max(...tail.map((sample) => sample.resources));

  expect(rendererCrashes).toBe(0);
  expect(snapshotFailures).toBe(0);
  expect(Math.max(...samples.map((sample) => sample.windows))).toBeLessThanOrEqual(3);
  expect(tailRss - baselineRss).toBeLessThan(256 * 1024 * 1024);
  expect(tailHeap - baselineHeap).toBeLessThan(128 * 1024 * 1024);
  expect(tailResources - baselineResources).toBeLessThanOrEqual(64);
});
