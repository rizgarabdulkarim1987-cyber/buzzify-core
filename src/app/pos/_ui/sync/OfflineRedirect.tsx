'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSync } from './SyncProvider';

/**
 * The till's pages work through the server, so they cannot run without a connection. When the device is offline and holds a
 * saved copy, the cashier moves to the offline till, where every action is queued and sent later.
 */
export function OfflineRedirect() {
  const sync = useSync();
  const router = useRouter();
  const away = sync.ready && !sync.online && sync.snapshot !== null;
  useEffect(() => {
    if (away) router.replace('/pos/offline');
  }, [away, router]);
  return null;
}
