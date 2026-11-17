import { useEffect, useState } from 'react';
import type { RelaySyncHealth } from '@/types';
import { relativeSyncedLabel } from '@/lib/relayTrips';
import { cn } from '@/lib/utils';

export function SyncStatusLine({ health }: { health: RelaySyncHealth }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (health.status === 'paused') {
    return (
      <p className="mt-1 text-sm font-medium text-danger" title={health.lastSyncedAt || undefined}>
        {health.detail || 'Sync paused – log in to Relay'}
      </p>
    );
  }

  if (health.status === 'unknown') {
    return (
      <p className="mt-1 text-sm text-text-secondary" title={health.detail || undefined}>
        {health.detail || 'Waiting for first Relay sync…'}
      </p>
    );
  }

  return (
    <p
      className={cn('mt-1 text-sm font-medium text-success')}
      title={health.lastSyncedAt || undefined}
    >
      {relativeSyncedLabel(health.lastSyncedAt)}
    </p>
  );
}
