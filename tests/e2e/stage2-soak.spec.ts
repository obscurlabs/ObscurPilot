import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CYCLES = 100;

test('packaged shell starts and shuts down cleanly 100 consecutive times', async () => {
  test.setTimeout(5 * 60_000);
  const executablePath = resolve('artifacts/win-unpacked/ObscurPilot.exe');
  test.skip(!existsSync(executablePath), 'Run npm run package:dir before packaged soak testing');

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    const exitCode = await runSmokeCycle(executablePath);
    expect(exitCode, 'smoke cycle ' + cycle).toBe(0);
  }
});

function runSmokeCycle(executablePath: string): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, ['--smoke-exit'], {
      env: { ...process.env, OBSCURPILOT_E2E: '1' },
      stdio: 'ignore',
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Packaged smoke cycle exceeded 10 seconds'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolvePromise(code);
    });
  });
}
