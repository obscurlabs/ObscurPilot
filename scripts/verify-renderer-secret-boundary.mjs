import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(process.cwd(), 'apps/desktop/dist-renderer');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map']);
const forbiddenMarkers = [
  'GROQ_API_KEY',
  'OBS_WEBSOCKET_PASSWORD',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OBSCURPILOT_DELETION_JOB_SECRET',
  'TWITCH_CLIENT_SECRET',
  'sb_secret_',
];

const violations = [];
for (const path of await walk(root)) {
  if (!textExtensions.has(extname(path))) continue;
  const content = await readFile(path, 'utf8');
  for (const marker of forbiddenMarkers) {
    if (content.includes(marker)) violations.push({ path, marker });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    process.stderr.write(
      'Renderer secret-boundary violation: ' + violation.marker + ' ' + violation.path + '\n',
    );
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Renderer secret-boundary scan passed.\n');
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
