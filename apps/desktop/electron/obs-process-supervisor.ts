import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join } from 'node:path';
import type { ObsSnapshot } from '@obscurpilot/contracts/obs';

export interface ObsProcessSupervisorOptions {
  readonly executablePath?: string;
  readonly getSnapshot: () => ObsSnapshot | undefined;
  readonly reconnect: () => Promise<void>;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly spawnProcess?: typeof spawn;
}

export function resolveObsExecutable(
  configuredPath = '',
  environment: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const configured = configuredPath.trim();
  const candidates = [
    ...(configured !== '' && extname(configured).toLowerCase() === '.exe' ? [configured] : []),
    environment.ProgramFiles === undefined
      ? undefined
      : join(environment.ProgramFiles, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    environment['ProgramFiles(x86)'] === undefined
      ? undefined
      : join(environment['ProgramFiles(x86)'], 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    ...(configured !== '' ? [configured] : []),
  ].filter((candidate): candidate is string => candidate !== undefined);
  return candidates.find(
    (candidate) =>
      isAbsolute(candidate) && extname(candidate).toLowerCase() === '.exe' && exists(candidate),
  );
}

export class ObsProcessSupervisor {
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly spawnProcess: typeof spawn;
  private child: ChildProcess | undefined;
  private launching: Promise<ObsSnapshot> | undefined;

  public constructor(private readonly options: ObsProcessSupervisorOptions) {
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  public ensureReady(timeoutMs = 30_000): Promise<ObsSnapshot> {
    const snapshot = this.options.getSnapshot();
    if (snapshot !== undefined) return Promise.resolve(snapshot);
    if (this.launching !== undefined) return this.launching;
    const run = this.launchAndWait(timeoutMs).finally(() => {
      if (this.launching === run) this.launching = undefined;
    });
    this.launching = run;
    return run;
  }

  private async launchAndWait(timeoutMs: number): Promise<ObsSnapshot> {
    const existing = await this.waitForSnapshot(Math.min(3_000, timeoutMs));
    if (existing !== undefined) return existing;
    const executable = resolveObsExecutable(this.options.executablePath);
    if (executable === undefined) throw new Error('OBS_EXECUTABLE_NOT_CONFIGURED');
    if (!isAbsolute(executable) || !existsSync(executable))
      throw new Error('OBS_EXECUTABLE_INVALID');
    if (this.child === undefined || this.child.exitCode !== null) {
      const child = this.spawnProcess(executable, [], {
        cwd: dirname(executable),
        shell: false,
        windowsHide: false,
        stdio: 'ignore',
      });
      child.once('exit', () => {
        if (this.child === child) this.child = undefined;
      });
      child.unref();
      this.child = child;
    }
    await this.options.reconnect().catch(() => undefined);
    const snapshot = await this.waitForSnapshot(Math.max(1_000, timeoutMs - 3_000));
    if (snapshot === undefined) throw new Error('OBS_START_TIMEOUT');
    return snapshot;
  }

  private async waitForSnapshot(timeoutMs: number): Promise<ObsSnapshot | undefined> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const snapshot = this.options.getSnapshot();
      if (snapshot !== undefined) return snapshot;
      await this.sleep(250);
    }
    return this.options.getSnapshot();
  }
}
