import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
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
    apiKeys: [
      'getBootstrap',
      'getSnapshot',
      'onStateChanged',
      'commandPtt',
      'setPttAccelerator',
      'listAudioDevices',
      'selectAudioDevice',
      'onPttChanged',
      'getHandsFreeProjection',
      'setHandsFreePreferences',
      'finishHandsFreeSpeech',
      'onHandsFreeChanged',
      'getAgentInteraction',
      'decideAgentConfirmation',
      'onAgentInteractionChanged',
      'getObsSnapshot',
      'reconnectObs',
      'getOnboarding',
      'pairObs',
      'clearObsPairing',
      'getCloudAuth',
      'signInCloud',
      'signUpCloud',
      'resendCloudConfirmation',
      'signOutCloud',
      'requestCloudAccountDeletion',
      'getTwitchProjection',
      'connectTwitch',
      'disconnectTwitch',
      'reconnectTwitch',
      'searchTwitchCategories',
      'onTwitchActivity',
      'getLiveSession',
      'getLiveSessionProfiles',
      'prepareLiveSession',
      'decideLiveSession',
      'stopLiveSession',
      'emergencyStopLiveSession',
      'executeModeration',
      'onLiveSessionChanged',
      'onChatMessage',
      'onChatAnalysis',
      'getPilotOverlayPreferences',
      'setPilotOverlayPreferences',
    ],
    requireType: 'undefined',
    processType: 'undefined',
  });

  await expect(page.getByText('Stage 13 · Hardened runtime')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Connect your production workspace' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Control board sections' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Command', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('region', { name: 'Provider readiness' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hold to speak' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connection supervisors' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Activity timeline filters' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recovery center' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Control-board settings' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  if (process.env.OBSCURPILOT_CAPTURE_UI === '1') {
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.screenshot({ path: 'test-results/stage-10-control-board.png' });
    await page
      .locator('#activity-timeline')
      .screenshot({ path: 'test-results/stage-10-activity-timeline.png' });
  }
}

async function getMainWindow(application: ElectronApplication): Promise<Page> {
  await application.firstWindow();
  await expect
    .poll(() => application.windows().some((page) => page.url() === 'app://bundle/index.html'))
    .toBe(true);
  const mainWindow = application.windows().find((page) => page.url() === 'app://bundle/index.html');
  if (mainWindow === undefined) throw new Error('Main ObscurPilot window was not created');
  return mainWindow;
}

test('production renderer starts behind the narrow preload boundary', async () => {
  const require = createRequire(import.meta.url);
  const electronPath: unknown = require('electron');
  if (typeof electronPath !== 'string') {
    throw new Error('Pinned Electron executable could not be resolved');
  }

  const electronApplication = await electron.launch({
    args: [
      resolve('apps/desktop'),
      '--user-data-dir=' + resolve('test-results', 'overlay-ipc-' + process.pid),
    ],
    executablePath: electronPath,
    env: {
      ...process.env,
      OBSCURPILOT_E2E: '1',
    },
  });

  try {
    const page = await getMainWindow(electronApplication);
    await expectNarrowRendererBoundary(page);
    for (let reload = 0; reload < 5; reload += 1) {
      await page.reload();
      await expectNarrowRendererBoundary(page);
    }

    const axePath = require.resolve('axe-core/axe.min.js');
    await page.evaluate(readFileSync(axePath, 'utf8'));
    const accessibilityViolations = await page.evaluate(async () => {
      const axe = (
        globalThis as typeof globalThis & {
          axe: {
            run: (
              context: Document,
              options: { runOnly: { type: 'tag'; values: string[] } },
            ) => Promise<{ violations: Array<{ id: string; help: string; nodes: unknown[] }> }>;
          };
        }
      ).axe;
      const results = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return results.violations.map(({ id, help, nodes }) => ({ id, help, nodes: nodes.length }));
    });
    expect(accessibilityViolations).toEqual([]);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() =>
        page.locator('.orb-core').evaluate((element) => getComputedStyle(element).animationName),
      )
      .toBe('none');

    await page.emulateMedia({ contrast: 'more' });
    await expect
      .poll(() =>
        page.locator('#activity-timeline').evaluate((element) => {
          return Number.parseFloat(getComputedStyle(element).borderWidth);
        }),
      )
      .toBeGreaterThanOrEqual(1.5);

    await page.setViewportSize({ width: 375, height: 760 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.locator('.skip-link').focus();
    await expect(page.locator('.skip-link')).toBeFocused();
  } finally {
    await electronApplication.close();
  }
});

test('corner Pilot mounts only after its projection IPC handlers are ready', async () => {
  const require = createRequire(import.meta.url);
  const electronPath: unknown = require('electron');
  if (typeof electronPath !== 'string') {
    throw new Error('Pinned Electron executable could not be resolved');
  }

  const electronApplication = await electron.launch({
    args: [
      resolve('apps/desktop'),
      '--user-data-dir=' + resolve('test-results', 'overlay-ipc-race-' + process.pid),
    ],
    executablePath: electronPath,
    env: { ...process.env, OBSCURPILOT_E2E: '1' },
  });
  const stderr: string[] = [];
  electronApplication.process().stderr?.setEncoding('utf8');
  electronApplication.process().stderr?.on('data', (chunk: string) => stderr.push(chunk));
  try {
    await getMainWindow(electronApplication);
    await expect
      .poll(() =>
        electronApplication
          .windows()
          .find((candidate) => candidate.url() === 'app://bundle/overlay.html'),
      )
      .toBeTruthy();
    const overlay = electronApplication
      .windows()
      .find((candidate) => candidate.url() === 'app://bundle/overlay.html');
    if (overlay === undefined) throw new Error('Corner Pilot overlay was not created');
    await expect(overlay.getByText('OBSCURPILOT')).toBeVisible();
    await expect(overlay.locator('.pilot-presence')).toHaveAttribute('data-phase', /.+/u);
    await overlay.waitForTimeout(500);
    expect(stderr.join('')).not.toMatch(
      /No handler registered for '(?:agent:get-projection|live-session:get-projection|audio:hands-free-get):v1'/u,
    );
  } finally {
    await electronApplication.close();
  }
});

test('closing the control board shuts down the hidden audio runtime', async () => {
  const require = createRequire(import.meta.url);
  const electronPath: unknown = require('electron');
  if (typeof electronPath !== 'string') {
    throw new Error('Pinned Electron executable could not be resolved');
  }

  const electronApplication = await electron.launch({
    args: [
      resolve('apps/desktop'),
      '--user-data-dir=' + resolve('test-results', 'shutdown-' + process.pid),
    ],
    executablePath: electronPath,
    env: {
      ...process.env,
      OBSCURPILOT_E2E: '1',
    },
  });
  let exited = false;
  try {
    await getMainWindow(electronApplication);
    const processExited = new Promise<void>((resolveExit, rejectExit) => {
      const timer = setTimeout(
        () => rejectExit(new Error('Electron did not exit after the main window closed')),
        8_000,
      );
      electronApplication.process().once('exit', () => {
        clearTimeout(timer);
        exited = true;
        resolveExit();
      });
    });
    await electronApplication.evaluate(({ BrowserWindow }) => {
      const controlBoard = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.getURL() === 'app://bundle/index.html',
      );
      if (controlBoard === undefined) throw new Error('Control board window is unavailable');
      // Return across Playwright's RPC boundary before closing the renderer that
      // carries that boundary; Page.close() can otherwise wait on its own teardown.
      setTimeout(() => controlBoard.close(), 100);
    });
    await processExited;
  } finally {
    if (!exited) await electronApplication.close();
  }
});

test('unsigned unpacked Windows artifact starts successfully', async () => {
  const executablePath = resolve('artifacts/win-unpacked/ObscurPilot.exe');
  test.skip(!existsSync(executablePath), 'Run npm run package:dir before packaged smoke testing');

  const electronApplication = await electron.launch({
    executablePath,
    args: ['--user-data-dir=' + resolve('test-results', 'artifact-' + process.pid)],
    env: { ...process.env, OBSCURPILOT_E2E: '1' },
  });
  try {
    await expectNarrowRendererBoundary(await getMainWindow(electronApplication));
  } finally {
    await electronApplication.close();
  }
});
