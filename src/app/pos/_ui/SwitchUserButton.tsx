'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/pos-format';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { useSyncOptional } from './sync/SyncProvider';

/** "Switch user" in the till header, shown only on a registered shared device. It waits for the queue and the network. */
export function SwitchUserButton() {
  const t = useT();
  const sync = useSyncOptional();
  const [busy, setBusy] = useState(false);
  const online = sync?.online ?? true;
  const waiting = sync ? sync.counts.pending + sync.counts.blocked + sync.counts.attention : 0;

  return (
    <Button
      variant="secondary"
      size="md"
      className="min-h-12"
      pending={busy}
      onClick={async () => {
        if (!online) return toast.error(t('pos.switch.needsNetwork'));
        if (waiting > 0) return toast.error(t('pos.switch.pendingWarn', { n: formatNumber(waiting) }));
        setBusy(true);
        // The person leaves first: nobody can press Back into their session while the switch screen is up.
        await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: '{}' }).catch(() => undefined);
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/pos/switch';
      }}
    >
      {t('pos.switch.button')}
    </Button>
  );
}
