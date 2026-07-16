import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import type { AppSnapshot, ConnectionProjection } from '@obscurpilot/contracts/state';
import type { TwitchActivity } from '@obscurpilot/contracts/twitch';

export const MAX_ACTIVITY_EVENTS = 10_000;
export const ACTIVITY_PAGE_SIZE = 100;

export type ActivitySource = 'agent' | 'obs' | 'system' | 'twitch';
export type ActivitySeverity = 'info' | 'success' | 'warning' | 'error';

export interface ActivityItem {
  readonly id: string;
  readonly source: ActivitySource;
  readonly severity: ActivitySeverity;
  readonly kind: string;
  readonly summary: string;
  readonly detail: string;
  readonly occurredAt: string;
}

export interface ActivityFilters {
  readonly query: string;
  readonly source: ActivitySource | 'all';
  readonly severity: ActivitySeverity | 'all';
}

export interface VirtualWindow {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly offsetTop: number;
  readonly totalHeight: number;
}

const ATTENTION_PHASES = new Set<ConnectionProjection['phase']>([
  'auth_required',
  'backoff',
  'degraded',
  'reconnecting',
]);

export function severityForConnection(connection: ConnectionProjection): ActivitySeverity {
  if (connection.phase === 'ready') return 'success';
  if (connection.phase === 'stopped') return 'error';
  if (ATTENTION_PHASES.has(connection.phase)) return 'warning';
  return 'info';
}

export function activityFromConnection(connection: ConnectionProjection): ActivityItem {
  return {
    id: `connection:${connection.provider}:${connection.changedAt}:${connection.attempt}`,
    source: connection.provider === 'obs' ? 'obs' : 'system',
    severity: severityForConnection(connection),
    kind: `${connection.provider}.connection.${connection.phase}`,
    summary: `${connection.provider.toUpperCase()} is ${connection.phase.replaceAll('_', ' ')}`,
    detail: connection.reasonCode.replaceAll('_', ' '),
    occurredAt: connection.changedAt,
  };
}

export function activityFromTwitch(activity: TwitchActivity): ActivityItem {
  return {
    id: `twitch:${activity.id}`,
    source: 'twitch',
    severity: activity.type === 'stream.offline' ? 'warning' : 'success',
    kind: activity.type,
    summary: activity.summary,
    detail: 'Authoritative Twitch EventSub update',
    occurredAt: activity.occurredAt,
  };
}

export function activityFromAgent(agent: AgentInteractionProjection): ActivityItem {
  const severity: ActivitySeverity =
    agent.phase === 'error'
      ? 'error'
      : agent.phase === 'awaiting_confirmation'
        ? 'warning'
        : agent.phase === 'completed'
          ? 'success'
          : 'info';
  const identity = agent.correlationId ?? `${agent.phase}:${agent.elapsedMs}`;
  return {
    id: `agent:${identity}:${agent.phase}`,
    source: 'agent',
    severity,
    kind: `agent.${agent.phase}`,
    summary: `Agent ${agent.phase.replaceAll('_', ' ')}`,
    detail: agent.reasonCode.replaceAll('_', ' '),
    occurredAt: new Date().toISOString(),
  };
}

export function activitiesFromSnapshot(snapshot: AppSnapshot): readonly ActivityItem[] {
  const restored: ActivityItem = {
    id: `snapshot:${snapshot.snapshotVersion}`,
    source: 'system',
    severity: 'info',
    kind: 'system.snapshot.restored',
    summary: `Runtime snapshot ${snapshot.snapshotVersion} restored`,
    detail: `Authoritative state generated at ${snapshot.generatedAt}`,
    occurredAt: snapshot.generatedAt,
  };
  return [restored, ...Object.values(snapshot.connections).map(activityFromConnection)];
}

export function mergeActivityBatch(
  current: readonly ActivityItem[],
  incoming: readonly ActivityItem[],
  limit = MAX_ACTIVITY_EVENTS,
): readonly ActivityItem[] {
  if (incoming.length === 0) return current;
  const seen = new Set<string>();
  const merged: ActivityItem[] = [];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length === limit) return merged;
  }
  for (const item of current) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length === limit) break;
  }
  return merged;
}

export function filterActivities(
  activities: readonly ActivityItem[],
  filters: ActivityFilters,
): readonly ActivityItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  if (query.length === 0 && filters.source === 'all' && filters.severity === 'all') {
    return activities;
  }
  return activities.filter((activity) => {
    if (filters.source !== 'all' && activity.source !== filters.source) return false;
    if (filters.severity !== 'all' && activity.severity !== filters.severity) return false;
    if (query.length === 0) return true;
    return `${activity.summary} ${activity.detail} ${activity.kind}`
      .toLocaleLowerCase()
      .includes(query);
  });
}

export function calculateVirtualWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 5,
): VirtualWindow {
  if (itemCount <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 };
  }
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(itemCount, startIndex + visibleCount);
  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * rowHeight,
    totalHeight: itemCount * rowHeight,
  };
}
