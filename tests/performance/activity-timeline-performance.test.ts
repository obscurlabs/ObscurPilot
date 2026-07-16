import {
  calculateVirtualWindow,
  filterActivities,
  MAX_ACTIVITY_EVENTS,
  mergeActivityBatch,
  type ActivityItem,
} from '../../apps/desktop/src/lib/activity-timeline';
import { describe, expect, it } from 'vitest';

describe('Stage 10 activity timeline performance', () => {
  it('projects and filters 10,000 events within the renderer interaction budget', () => {
    const fixture: ActivityItem[] = Array.from({ length: MAX_ACTIVITY_EVENTS }, (_, index) => ({
      id: `fixture-${index}`,
      source: index % 2 === 0 ? 'twitch' : 'system',
      severity: index % 5 === 0 ? 'warning' : 'info',
      kind: 'fixture.event',
      summary: `Fixture event ${index}`,
      detail: index % 11 === 0 ? 'authoritative reconnect' : 'normal update',
      occurredAt: new Date(index * 100).toISOString(),
    }));

    const startedAt = performance.now();
    const bounded = mergeActivityBatch([], fixture);
    const filtered = filterActivities(bounded, {
      query: 'reconnect',
      source: 'all',
      severity: 'all',
    });
    const windowed = calculateVirtualWindow(filtered.length, 12_000, 392, 84);
    const elapsedMs = performance.now() - startedAt;

    expect(bounded).toHaveLength(MAX_ACTIVITY_EVENTS);
    expect(filtered.length).toBeGreaterThan(800);
    expect(windowed.endIndex - windowed.startIndex).toBeLessThanOrEqual(15);
    expect(elapsedMs).toBeLessThan(100);
  });
});
