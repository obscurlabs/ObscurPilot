import { execFile } from 'node:child_process';
import { z } from 'zod';

export const ObsProcessInspectionSchema = z
  .object({
    running: z.boolean(),
    processId: z.number().int().positive().optional(),
    windowVisible: z.boolean(),
    windowTitle: z.string().max(256).optional(),
  })
  .strict();

export type ObsProcessInspection = z.infer<typeof ObsProcessInspectionSchema>;

type Execute = (file: string, args: readonly string[]) => Promise<string>;

const INSPECT_OBS_SCRIPT = [
  'Get-Process -Name obs64 -ErrorAction SilentlyContinue',
  'Sort-Object StartTime',
  'Select-Object -First 1',
  "Select-Object @{Name='running';Expression={$true}},@{Name='processId';Expression={[int]$_.Id}},@{Name='windowVisible';Expression={$_.MainWindowHandle -ne 0}},@{Name='windowTitle';Expression={[string]$_.MainWindowTitle}}",
  'ConvertTo-Json -Compress',
].join(' | ');

const FOCUS_OBS_SCRIPT = [
  'Get-Process -Name obs64 -ErrorAction SilentlyContinue',
  'Where-Object {$_.MainWindowHandle -ne 0}',
  'Select-Object -First 1',
  'ForEach-Object {(New-Object -ComObject WScript.Shell).AppActivate([int]$_.Id) | Out-Null}',
].join(' | ');

export class WindowsDesktopSupervisor {
  public constructor(
    private readonly platform = process.platform,
    private readonly execute: Execute = executePowerShell,
  ) {}

  public async inspectObs(): Promise<ObsProcessInspection> {
    if (this.platform !== 'win32') return { running: false, windowVisible: false };
    const output = await this.execute('powershell.exe', powerShellArguments(INSPECT_OBS_SCRIPT));
    if (output.trim() === '') return { running: false, windowVisible: false };
    return ObsProcessInspectionSchema.parse(JSON.parse(output.trim()) as unknown);
  }

  public async focusObs(): Promise<boolean> {
    if (this.platform !== 'win32') return false;
    try {
      await this.execute('powershell.exe', powerShellArguments(FOCUS_OBS_SCRIPT));
      return true;
    } catch {
      return false;
    }
  }
}

function powerShellArguments(script: string): readonly string[] {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script];
}

function executePowerShell(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { windowsHide: true, timeout: 3_000, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
}
