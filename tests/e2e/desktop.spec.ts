import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

async function expectNarrowRendererBoundary(page: Page): Promise<void> {
  await expect(page).toHaveTitle('ObscurPilot');
  await expect(page.getByRole('heading', { name: 'ObscurPilot' })).toBeVisible();

  const boundary = await page.evaluate(() => {
    const candidate = globalThis as typeof globalThis & {
      obscurPilot?: Record<string, unknown>;
      require?: unknown;
      process?: unknown;
    };

    return {
      apiKeys: Object.keys(candidate.obscurPilot ?? {}),
      requireType: typeof candidate.require,
      processType: typeof candidate.process,
    };
  });

  expect(boundary).toEqual({
    apiKeys: ['getBootstrap', 'getSnapshot', 'onStateChanged'],
    requireType: 'undefined',
    processType: 'undefined',
  });

  await expect(page.getByText('Stages 2–3')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connection supervisors' })).toBeVisible();
}

test('production renderer starts behind the narrow preload boundary', async () => {
  const require = createRequire(import.meta.url);
  const electronPath: unknown = require('electron');
  if (typeof electronPath !== 'string') {
    throw new Error('Pinned Electron executable could not be resolved');
  }

  const electronApplication = await electron.launch({
    args: [resolve('apps/desktop')],
    executablePath: electronPath,
    env: {
      ...process.env,
      OBSCURPILOT_E2E: '1',
    },
  });

  try {
    const page = await electronApplication.firstWindow();
    await expectNarrowRendererBoundary(page);
    for (let reload = 0; reload < 5; reload += 1) {
      await page.reload();
      await expectNarrowRendererBoundary(page);
    }
  } finally {
    await electronApplication.close();
  }
});

test('unsigned unpacked Windows artifact starts successfully', async () => {
  const executablePath = resolve('artifacts/win-unpacked/ObscurPilot.exe');
  test.skip(!existsSync(executablePath), 'Run npm run package:dir before packaged smoke testing');

  const electronApplication = await electron.launch({ executablePath });
  try {
    await expectNarrowRendererBoundary(await electronApplication.firstWindow());
  } finally {
    await electronApplication.close();
  }
});
