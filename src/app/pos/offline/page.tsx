import type { Metadata } from 'next';
import { OfflineTill } from '../_ui/sync/OfflineTill';

export const metadata: Metadata = { title: 'Offline till' };

/**
 * The shell the service worker keeps for the till. It holds no restaurant data and checks no session on the server: it reads
 * the device's own store, and every operation it queues is checked by the server when it is sent.
 */
export default function OfflinePage() {
  return (
    <main id="main" className="min-h-dvh">
      <OfflineTill />
    </main>
  );
}
