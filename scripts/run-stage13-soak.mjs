import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const argumentIndex = process.argv.indexOf('--minutes');
const minutes = Number(argumentIndex < 0 ? 480 : process.argv[argumentIndex + 1]);
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
  throw new RangeError('Soak duration must be greater than zero and no more than 1440 minutes');
}
const sampleMs = minutes <= 1 ? 2_000 : 15_000;
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const child = spawn(
  process.execPath,
  [playwrightCli, 'test', '--config', 'tests/soak/playwright.config.ts'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OBSCURPILOT_STAGE13_SOAK: '1',
      OBSCURPILOT_SOAK_MINUTES: String(minutes),
      OBSCURPILOT_SOAK_SAMPLE_MS: String(sampleMs),
    },
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.once('error', (error) => {
  process.stderr.write('Unable to start the Stage 13 soak: ' + error.message + '\n');
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal !== null) process.stderr.write('Stage 13 soak stopped by signal ' + signal + '\n');
  process.exitCode = code ?? 1;
});
