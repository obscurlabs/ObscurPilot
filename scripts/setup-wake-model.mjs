import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { stdout } from 'node:process';

const url =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2';
const expectedSha256 = 'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a';
const modelName = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
const target = resolve('apps/desktop/resources/wake-word');
const staging = target + '.staging';
const archive = resolve('apps/desktop/resources/sherpa-kws-en.tar.bz2');

await mkdir(dirname(archive), { recursive: true });
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

const response = await globalThis.fetch(url, { redirect: 'follow' });
if (!response.ok || response.body === null) throw new Error('Wake model download failed');
await pipeline(response.body, createWriteStream(archive));
const hash = createHash('sha256');
await pipeline(createReadStream(archive), hash);
if (hash.digest('hex') !== expectedSha256) throw new Error('Wake model checksum mismatch');

await run('tar', ['-xjf', archive, '-C', staging]);
const extracted = resolve(staging, modelName);
await writeFile(
  resolve(extracted, 'obscurpilot-keywords.txt'),
  '▁HI ▁O B S C U R @HI_OBSCUR\n',
  'utf8',
);
await readFile(resolve(extracted, 'tokens.txt'));
await rm(target, { recursive: true, force: true });
await rename(extracted, target);
await rm(staging, { recursive: true, force: true });
await rm(archive, { force: true });
stdout.write('Verified offline wake model installed at ' + target + '\n');

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { shell: false, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectPromise);
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(command + ' exited ' + code)),
    );
  });
}
