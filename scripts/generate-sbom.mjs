import { spawnSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const npmCli = process.env.npm_execpath;
if (npmCli === undefined || npmCli.length === 0) {
  throw new Error('Run this generator through npm run sbom so the pinned npm CLI is available');
}

const outputPath = resolve('artifacts/stage-13/sbom.cdx.json');
const temporaryPath = outputPath + '.tmp';
const result = spawnSync(
  process.execPath,
  [
    npmCli,
    'sbom',
    '--package-lock-only',
    '--omit=dev',
    '--sbom-format=cyclonedx',
    '--sbom-type=application',
  ],
  { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'npm sbom failed without diagnostic output\n');
  process.exit(result.status ?? 1);
}

const document = JSON.parse(result.stdout);
if (
  document.bomFormat !== 'CycloneDX' ||
  typeof document.specVersion !== 'string' ||
  !Array.isArray(document.components)
) {
  throw new Error('npm produced an invalid CycloneDX document');
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(temporaryPath, JSON.stringify(document, null, 2) + '\n', {
  encoding: 'utf8',
  mode: 0o600,
});
await rename(temporaryPath, outputPath);
process.stdout.write(
  'CycloneDX SBOM generated with ' + document.components.length + ' production components.\n',
);
