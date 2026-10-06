import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { z } from 'zod';

/*
 * Zero-config OBS: rather than asking the creator to copy a port and password into .env,
 * read them from OBS's own obs-websocket settings on this machine, and switch the server on
 * when it is off. OBS rewrites that file on exit, so it is only edited while OBS is closed.
 */

const ObsWebSocketFileSchema = z
  .object({
    server_enabled: z.boolean().optional(),
    server_port: z.number().int().min(1).max(65_535).optional(),
    auth_required: z.boolean().optional(),
    server_password: z.string().optional(),
  })
  .passthrough();

export interface ObsWebSocketSettings {
  readonly enabled: boolean;
  readonly port: number;
  readonly password?: string;
}

export function obsWebSocketConfigPath(appDataPath: string): string {
  return join(appDataPath, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
}

export function readObsWebSocketSettings(path: string): ObsWebSocketSettings | undefined {
  try {
    const file = ObsWebSocketFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    const password = file.auth_required === false ? undefined : file.server_password || undefined;
    return {
      enabled: file.server_enabled === true,
      port: file.server_port ?? 4455,
      ...(password === undefined ? {} : { password }),
    };
  } catch {
    return undefined;
  }
}

/** Turns the obs-websocket server on, keeping any existing password. Call only with OBS closed. */
export async function enableObsWebSocket(path: string): Promise<ObsWebSocketSettings> {
  let existing: Record<string, unknown> = {};
  try {
    existing = ObsWebSocketFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    // No usable file yet: OBS has never saved WebSocket settings on this machine.
  }
  const current = ObsWebSocketFileSchema.parse(existing);
  const next = {
    ...existing,
    server_enabled: true,
    server_port: current.server_port ?? 4455,
    auth_required: current.auth_required ?? true,
    server_password: current.server_password || randomBytes(12).toString('base64url'),
    first_load: false,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), 'utf8');
  return readObsWebSocketSettings(path) ?? { enabled: true, port: next.server_port };
}

export function findObsExecutable(configured: string | undefined): string | undefined {
  const isUsable = (path: string) =>
    isAbsolute(path) &&
    (process.platform !== 'win32' || extname(path) === '.exe') &&
    existsSync(path);
  if (configured !== undefined && isUsable(configured)) return configured;
  if (process.platform !== 'win32') return undefined;
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'),
  ].filter((root): root is string => Boolean(root));
  const candidates = [
    ...roots.map((root) => join(root, 'obs-studio', 'bin', '64bit', 'obs64.exe')),
    ...roots.map((root) =>
      join(root, 'Steam', 'steamapps', 'common', 'OBS Studio', 'bin', '64bit', 'obs64.exe'),
    ),
  ];
  return candidates.find(isUsable);
}

export function isObsRunning(): Promise<boolean> {
  const [command, args, pattern] =
    process.platform === 'win32'
      ? (['tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], /obs64\.exe/iu] as const)
      : (['pgrep', ['-x', 'obs'], /\d/u] as const);
  return new Promise((resolve) => {
    execFile(command, [...args], { windowsHide: true, timeout: 5_000 }, (error, stdout) => {
      resolve(error === null && pattern.test(stdout));
    });
  });
}
