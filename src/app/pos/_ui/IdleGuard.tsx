'use client';

import { useEffect, useRef } from 'react';
import { signOut } from '@/app/studio/_actions/session';
import { watchIdle } from '@/lib/pos-idle';
import { navigateAway } from '@/studio/navigate';
import { useSyncOptional } from './sync/SyncProvider';

/**
 * Signs the person out of the till after the restaurant's idle minutes, so an abandoned till is not left open to anyone.
 * On a shared device it goes to the switch screen, as "Switch user" does. It never signs out while offline or while
 * unsent work waits in the queue; it tries again a minute later.
 */
export function IdleGuard({ minutes, shared }: { minutes: number; shared: boolean }) {
  const sync = useSyncOptional();
  const canLeave = useRef(true);
  const free = sync ? sync.online && sync.counts.pending + sync.counts.blocked + sync.counts.attention === 0 : true;
  useEffect(() => {
    canLeave.current = free;
  }, [free]);

  useEffect(
    () =>
      watchIdle(window, minutes, () => {
        if (!canLeave.current) return false;
        void (async () => {
          if (shared) {
            await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: '{}' }).catch(() => undefined);
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = '/pos/switch';
            return;
          }
          const result = await signOut({});
          if (result.ok) navigateAway(result.data.next);
        })();
        return true;
      }),
    [minutes, shared],
  );
  return null;
}
