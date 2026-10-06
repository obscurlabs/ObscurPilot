import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute } from 'node:path';
import type { ObsSnapshot } from '@obscurpilot/contracts/obs';

export interface ObsProcessSupervisorOptions {
  readonly executablePath?: string;
  readonly getSnapshot: () => ObsSnapshot | undefined;
  readonly reconnect: () => Promise<void>;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly spawnProcess?: typeof spawn;
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
    const executable = this.options.executablePath;
    if (executable === undefined) throw new Error('OBS_EXECUTABLE_NOT_CONFIGURED');
    // A .lnk shortcut cannot be spawned without a shell; point at obs64.exe itself.
    const notExecutable = process.platform === 'win32' && extname(executable) !== '.exe';
    if (!isAbsolute(executable) || notExecutable || !existsSync(executable))
      throw new Error('OBS_EXECUTABLE_INVALID');
    if (this.child === undefined || this.child.exitCode !== null) {
      // OBS resolves locale and plugin data relative to its working directory and quits
      // with "Failed to find locale/en-US.ini" when started from anywhere else.
      const child = this.spawnProcess(executable, [], {
        cwd: dirname(executable),
        shell: false,
        windowsHide: false,
        stdio: 'ignore',
      });
      const forget = () => {
        if (this.child === child) this.child = undefined;
      };
      child.once('exit', forget);
      child.once('error', forget);
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
