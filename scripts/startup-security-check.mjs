#!/usr/bin/env node
/**
 * Combined startup security check. Run once when you start working on the
 * project (`npm run check`), not on every build:
 *
 *   1. Production dependency vulnerability audit (npm audit, high+).
 *   2. Production license allowlist audit.
 *   3. Renderer secret-boundary scan (skipped when no built renderer exists).
 *   4. Local secret hygiene: .env style files must never be git-tracked.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const steps = [];
let failed = false;

function run(name, command) {
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    execSync(command, { stdio: 'inherit' });
    steps.push({ name, result: 'pass' });
  } catch {
    steps.push({ name, result: 'FAIL' });
    failed = true;
  }
}

run('Dependency vulnerability audit (production, high+)', 'npm audit --omit=dev --audit-level=high');

run(
  'License allowlist audit (production)',
  'npx license-checker-rseidelsohn --production --excludePrivatePackages --onlyAllow "Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;MIT;0BSD;BlueOak-1.0.0"',
);

if (existsSync(resolve(process.cwd(), 'apps/desktop/dist-renderer'))) {
  run('Renderer secret-boundary scan', 'node scripts/verify-renderer-secret-boundary.mjs');
} else {
  process.stdout.write('\n=== Renderer secret-boundary scan ===\n');
  process.stdout.write('Skipped: no built renderer (run `npm run build` first to include it).\n');
  steps.push({ name: 'Renderer secret-boundary scan', result: 'skipped' });
}

process.stdout.write('\n=== Tracked secret file check ===\n');
try {
  const tracked = execSync('git ls-files ".env" ".env.*"', { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '' && line.trim() !== '.env.example');
  if (tracked.length > 0) {
    for (const file of tracked) {
      process.stderr.write(`Secret file tracked by git: ${file}\n`);
    }
    steps.push({ name: 'Tracked secret file check', result: 'FAIL' });
    failed = true;
  } else {
    process.stdout.write('No secret env files tracked by git.\n');
    steps.push({ name: 'Tracked secret file check', result: 'pass' });
  }
} catch {
  steps.push({ name: 'Tracked secret file check', result: 'FAIL' });
  failed = true;
}

process.stdout.write('\n=== Startup security summary ===\n');
for (const step of steps) {
  process.stdout.write(`${step.result.padEnd(7)} ${step.name}\n`);
}
process.exitCode = failed ? 1 : 0;
