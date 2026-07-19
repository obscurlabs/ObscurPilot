import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReliabilityTracker } from '@obscurpilot/domain/reliability-tracker';
import { SherpaWakeWord, WakeWordAudioGate } from '../../apps/desktop/electron/sherpa-wake-word';
import { WindowsDesktopSupervisor } from '../../apps/desktop/electron/windows-desktop-supervisor';
import { describe, expect, it, vi } from 'vitest';

describe('Stage 11.7 local desktop and wake boundary', () => {
  it('inspects only the fixed OBS process and rejects malformed OS output', async () => {
    const execute = vi.fn(async (file: string, args: readonly string[]) => {
      expect(file).toBe('powershell.exe');
      expect(args.join(' ')).toContain('obs64');
      return JSON.stringify({
        running: true,
        processId: 42,
        windowVisible: true,
        windowTitle: 'OBS 31',
      });
    });
    const supervisor = new WindowsDesktopSupervisor('win32', execute);
    await expect(supervisor.inspectObs()).resolves.toMatchObject({
      running: true,
      processId: 42,
      windowVisible: true,
    });
    expect(execute.mock.calls[0]?.[1].join(' ')).toContain('obs64');

    const malformed = new WindowsDesktopSupervisor('win32', async () => '{"running":"yes"}');
    await expect(malformed.inspectObs()).rejects.toThrow();
  });

  it('buffers audio until local wake detection and then preserves sample order', () => {
    let active = false;
    let calls = 0;
    const output: number[][] = [];
    const gate = new WakeWordAudioGate(
      {
        accept: () => {
          calls += 1;
          return calls === 2;
        },
      },
      () => active,
      () => {
        active = true;
      },
      (samples) => output.push([...samples]),
      8,
    );
    gate.accept(Int16Array.from([1, 2]));
    expect(output).toEqual([]);
    gate.accept(Int16Array.from([3, 4]));
    expect(output).toEqual([
      [1, 2],
      [3, 4],
    ]);
    gate.accept(Int16Array.from([5]));
    expect(output.at(-1)).toEqual([5]);
  });

  it('loads a complete local model and honors detection cooldown', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'obscurpilot-wake-'));
    const files = [
      'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
      'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
      'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
      'tokens.txt',
      'obscurpilot-keywords.txt',
    ];
    await Promise.all(files.map((file) => writeFile(join(directory, file), 'fixture')));
    let now = 1_000;
    const stream = {
      acceptWaveform: vi.fn(),
    };
    class KeywordSpotter {
      public createStream() {
        return stream;
      }
      public isReady() {
        return false;
      }
      public decode() {}
      public reset() {}
      public getResult() {
        return { keyword: 'HI OBSCUR' };
      }
    }
    try {
      const detector = new SherpaWakeWord({
        modelDirectory: directory,
        score: 1.5,
        threshold: 0.35,
        cooldownMs: 2_000,
        now: () => now,
        loadModule: () => ({ KeywordSpotter }),
      });
      expect(detector.accept(Int16Array.from([1, -1]))).toBe(true);
      expect(detector.accept(Int16Array.from([1, -1]))).toBe(false);
      now += 2_001;
      expect(detector.accept(Int16Array.from([1, -1]))).toBe(true);
      expect(stream.acceptWaveform).toHaveBeenCalledTimes(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Stage 11.9 reliability metrics', () => {
  it('keeps bounded outcomes and reports deterministic percentiles', () => {
    const tracker = new ReliabilityTracker(10);
    for (let index = 1; index <= 12; index += 1) tracker.record(index !== 12, index * 10);
    tracker.recordRecovery();
    tracker.recordDuplicatePrevented();
    expect(tracker.snapshot()).toEqual({
      operations: 10,
      verified: 9,
      failed: 1,
      recoveries: 1,
      duplicatesPrevented: 1,
      successRate: 0.9,
      p50LatencyMs: 70,
      p95LatencyMs: 120,
    });
  });
});
