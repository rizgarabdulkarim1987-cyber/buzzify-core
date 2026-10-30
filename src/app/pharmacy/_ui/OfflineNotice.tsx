'use client';

import { WifiOff } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { useOnline } from './use-online';

/** Says in words, with an icon, that the connection is gone. Nothing when online. `messageKey` is the sentence (default: changes cannot be saved; the read-only report screens say the figures may be old). */
export function OfflineNotice({ messageKey = 'pharmacy.stock.offline' }: { messageKey?: string } = {}) {
  const t = useT();
  if (useOnline()) return null;
  return (
    <p data-testid="stock-offline" role="status" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
      <WifiOff aria-hidden className="mt-px size-4 shrink-0 text-muted" />
      <span className="min-w-0">{t(messageKey)}</span>
    </p>
  );
}
