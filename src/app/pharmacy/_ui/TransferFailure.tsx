'use client';

import { CircleAlert } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';

/** A refusal in words, with a Reload when the transfer changed under the person. Shared by the panels. */
export function TransferFailure({ message, stale, onReload, testId }: { message: string; stale: boolean; onReload: () => void; testId: string }) {
  const t = useT();
  return (
    <div role="alert" data-testid={testId} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
      <span className="flex min-w-0 items-start gap-2.5">
        <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
        <span className="min-w-0">{message}</span>
      </span>
      {stale && (
        <Button size="lg" className="min-h-11" onClick={onReload}>
          {t('pharmacy.transfers.reload')}
        </Button>
      )}
    </div>
  );
}
