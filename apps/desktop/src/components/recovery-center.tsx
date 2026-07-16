import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import {
  guidanceForConnection,
  type RecoveryAction,
  type RecoveryGuidance,
} from '../lib/recovery-guidance';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';

interface RecoveryItem {
  readonly provider: ConnectionProjection['provider'];
  readonly phase: ConnectionProjection['phase'];
  readonly guidance: RecoveryGuidance;
}

export function RecoveryCenter({
  connections,
  onAction,
}: {
  readonly connections: readonly ConnectionProjection[];
  readonly onAction: (action: RecoveryAction) => void;
}) {
  const items = connections.flatMap((connection): RecoveryItem[] => {
    const guidance = guidanceForConnection(connection);
    return guidance === null
      ? []
      : [{ provider: connection.provider, phase: connection.phase, guidance }];
  });

  return (
    <Card className="span-full" id="recovery" aria-labelledby="recovery-title">
      <CardHeader className="recovery-header">
        <div>
          <p className="eyebrow">Actionable system recovery</p>
          <h2 className="panel-title" id="recovery-title">
            Recovery center
          </h2>
        </div>
        <Badge tone={items.length === 0 ? 'ready' : 'waiting'}>
          {items.length === 0 ? 'No action needed' : `${items.length} need attention`}
        </Badge>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="recovery-clear">
            <span className="recovery-clear-mark" aria-hidden="true" />
            <div>
              <strong>All active providers are stable</strong>
              <p>Recovery guidance will appear here when an authoritative state needs action.</p>
            </div>
          </div>
        ) : (
          <div className="recovery-grid">
            {items.map(({ provider, phase, guidance }) => (
              <article className="recovery-item" key={provider}>
                <div className="recovery-item-heading">
                  <span>{provider.toUpperCase()}</span>
                  <Badge>{phase.replaceAll('_', ' ')}</Badge>
                </div>
                <strong>{guidance.title}</strong>
                <p>{guidance.description}</p>
                {guidance.actionLabel === undefined ? null : (
                  <Button
                    size="compact"
                    variant="secondary"
                    onClick={() => onAction(guidance.action)}
                  >
                    {guidance.actionLabel}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
