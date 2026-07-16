import {
  calculateVirtualWindow,
  filterActivities,
  MAX_ACTIVITY_EVENTS,
  mergeActivityBatch,
  type ActivityItem,
} from '../../apps/desktop/src/lib/activity-timeline';
import { describe, expect, it } from 'vitest';

function activity(index: number, overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: `activity-${index}`,
    source: 'system',
    severity: 'info',
    kind: 'system.fixture',
    summary: `Fixture activity ${index}`,
    detail: `Detail ${index}`,
    occurredAt: new Date(index * 1_000).toISOString(),
    ...overrides,
  };
}

describe('activity timeline projection', () => {
  it('deduplicates newest events and enforces the 10,000-event bound', () => {
    const existing = Array.from({ length: MAX_ACTIVITY_EVENTS }, (_, index) => activity(index));
    const merged = mergeActivityBatch(existing, [
      activity(5),
      activity(MAX_ACTIVITY_EVENTS, { severity: 'warning' }),
    ]);

    expect(merged).toHaveLength(MAX_ACTIVITY_EVENTS);
    expect(merged[0]?.id).toBe('activity-5');
    expect(merged[1]?.id).toBe(`activity-${MAX_ACTIVITY_EVENTS}`);
    expect(new Set(merged.map((item) => item.id)).size).toBe(MAX_ACTIVITY_EVENTS);
  });

  it('filters by deferred query, source and severity without changing source data', () => {
    const source = [
      activity(1, { source: 'obs', severity: 'warning', summary: 'OBS reconnecting' }),
      activity(2, { source: 'twitch', severity: 'success', summary: 'Stream online' }),
    ];
    expect(
      filterActivities(source, { query: 'reconnect', source: 'obs', severity: 'warning' }),
    ).toEqual([source[0]]);
    expect(source).toHaveLength(2);
  });

  it('renders only a small overscanned window for a large collection', () => {
    const windowed = calculateVirtualWindow(10_000, 420_000, 392, 84);
    expect(windowed.totalHeight).toBe(840_000);
    expect(windowed.startIndex).toBeGreaterThan(4_900);
    expect(windowed.endIndex - windowed.startIndex).toBeLessThanOrEqual(15);
  });
});
