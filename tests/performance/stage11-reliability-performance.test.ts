import { performance } from 'node:perf_hooks';
import { ReliabilityTracker } from '@obscurpilot/domain/reliability-tracker';
import { expect, it } from 'vitest';

it('projects ten thousand verified operations within the local telemetry budget', () => {
  const tracker = new ReliabilityTracker(10_000);
  const startedAt = performance.now();
  for (let index = 0; index < 10_000; index += 1) tracker.record(true, index % 2_000);
  const projection = tracker.snapshot();
  const elapsedMs = performance.now() - startedAt;
  expect(projection).toMatchObject({ operations: 10_000, verified: 10_000, failed: 0 });
  expect(elapsedMs).toBeLessThan(100);
});
