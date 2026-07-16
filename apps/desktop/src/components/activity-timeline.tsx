import { memo, useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  ACTIVITY_PAGE_SIZE,
  calculateVirtualWindow,
  filterActivities,
  type ActivityFilters,
  type ActivityItem,
  type ActivitySeverity,
  type ActivitySource,
} from '../lib/activity-timeline';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const VIEWPORT_HEIGHT = 392;

const ActivityRow = memo(function ActivityRow({
  activity,
  index,
  total,
}: {
  readonly activity: ActivityItem;
  readonly index: number;
  readonly total: number;
}) {
  return (
    <article
      className="activity-row"
      data-severity={activity.severity}
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={total}
    >
      <span className="activity-marker" aria-hidden="true" />
      <div className="activity-copy">
        <div className="activity-heading">
          <strong>{activity.summary}</strong>
          <time dateTime={activity.occurredAt}>
            {TIME_FORMATTER.format(new Date(activity.occurredAt))}
          </time>
        </div>
        <p>{activity.detail}</p>
      </div>
      <Badge tone={activity.severity === 'success' ? 'ready' : 'neutral'}>{activity.source}</Badge>
    </article>
  );
});

export function ActivityTimeline({ activities }: { readonly activities: readonly ActivityItem[] }) {
  const [filters, setFilters] = useState<ActivityFilters>({
    query: '',
    source: 'all',
    severity: 'all',
  });
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const deferredQuery = useDeferredValue(filters.query);
  const effectiveFilters = useMemo(
    () => ({
      query: deferredQuery,
      source: filters.source,
      severity: filters.severity,
    }),
    [deferredQuery, filters.severity, filters.source],
  );
  const filtered = useMemo(
    () => filterActivities(activities, effectiveFilters),
    [activities, effectiveFilters],
  );
  const rowHeight = document.documentElement.dataset.timelineDensity === 'compact' ? 68 : 84;
  const windowed = calculateVirtualWindow(filtered.length, scrollTop, VIEWPORT_HEIGHT, rowHeight);
  const visible = filtered.slice(windowed.startIndex, windowed.endIndex);
  const currentPage =
    filtered.length === 0 ? 0 : Math.floor(scrollTop / (rowHeight * ACTIVITY_PAGE_SIZE));
  const pageCount = Math.ceil(filtered.length / ACTIVITY_PAGE_SIZE);

  const goToPage = (page: number) => {
    const boundedPage = Math.max(0, Math.min(pageCount - 1, page));
    viewportRef.current?.scrollTo({ top: boundedPage * ACTIVITY_PAGE_SIZE * rowHeight });
    setScrollTop(boundedPage * ACTIVITY_PAGE_SIZE * rowHeight);
  };

  return (
    <Card className="span-full" id="activity-timeline" aria-labelledby="activity-title">
      <CardHeader className="activity-card-header">
        <div>
          <p className="eyebrow">Bounded operational history</p>
          <h2 className="panel-title" id="activity-title">
            Activity timeline
          </h2>
        </div>
        <div className="activity-count" aria-live="polite" aria-atomic="true">
          <strong>{filtered.length.toLocaleString()}</strong>
          <span>matching events</span>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="activity-filters"
          aria-label="Activity timeline filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="activity-search">
            <span>Search activity</span>
            <input
              type="search"
              value={filters.query}
              placeholder="Reason, provider or event"
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Source</span>
            <select
              value={filters.source}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  source: event.target.value as ActivitySource | 'all',
                }))
              }
            >
              <option value="all">All sources</option>
              <option value="agent">Agent</option>
              <option value="obs">OBS</option>
              <option value="system">System</option>
              <option value="twitch">Twitch</option>
            </select>
          </label>
          <label>
            <span>Severity</span>
            <select
              value={filters.severity}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  severity: event.target.value as ActivitySeverity | 'all',
                }))
              }
            >
              <option value="all">All levels</option>
              <option value="info">Information</option>
              <option value="success">Success</option>
              <option value="warning">Attention</option>
              <option value="error">Error</option>
            </select>
          </label>
          <Button
            size="compact"
            variant="ghost"
            disabled={
              filters.query.length === 0 && filters.source === 'all' && filters.severity === 'all'
            }
            onClick={() => setFilters({ query: '', source: 'all', severity: 'all' })}
          >
            Clear filters
          </Button>
        </form>

        <div
          className="activity-viewport"
          ref={viewportRef}
          role="list"
          aria-label="Operational activity"
          tabIndex={0}
          onScroll={(event) => {
            const nextTop = event.currentTarget.scrollTop;
            if (animationFrameRef.current !== undefined) {
              cancelAnimationFrame(animationFrameRef.current);
            }
            animationFrameRef.current = requestAnimationFrame(() => setScrollTop(nextTop));
          }}
        >
          {filtered.length === 0 ? (
            <div className="activity-empty">
              <strong>No matching activity</strong>
              <span>Change or clear the filters to restore events.</span>
            </div>
          ) : (
            <div className="activity-spacer" style={{ height: windowed.totalHeight }}>
              <div
                className="activity-window"
                style={{ transform: `translateY(${windowed.offsetTop}px)` }}
              >
                {visible.map((activity, visibleIndex) => (
                  <ActivityRow
                    activity={activity}
                    index={windowed.startIndex + visibleIndex}
                    key={activity.id}
                    total={filtered.length}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="activity-pagination" aria-label="Activity page navigation">
          <span>
            Page {pageCount === 0 ? 0 : currentPage + 1} of {pageCount}
          </span>
          <div>
            <Button
              size="compact"
              variant="ghost"
              disabled={currentPage <= 0}
              onClick={() => goToPage(currentPage - 1)}
            >
              Previous 100
            </Button>
            <Button
              size="compact"
              variant="ghost"
              disabled={currentPage >= pageCount - 1}
              onClick={() => goToPage(currentPage + 1)}
            >
              Next 100
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
