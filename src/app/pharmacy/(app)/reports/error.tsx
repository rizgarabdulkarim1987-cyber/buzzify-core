'use client';

import { CircleAlert, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';

/** A report failed to load: what happened, that nothing changed, and the way to try again (a server error is read again only after the router refreshes). */
export default function ReportsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const router = useRouter();
  return (
    <div role="alert" data-testid="reports-error" className="flex flex-col items-start gap-3 px-4 py-10 sm:px-8">
      <p className="flex items-center gap-2.5 text-md font-semibold text-text">
        <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />
        {t('pharmacy.reports.loadFailed')}
      </p>
      <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.reports.loadFailedBody')}</p>
      <Button size="lg" className="min-h-11" icon={<RotateCcw aria-hidden />} onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }>
        {t('pharmacy.reports.retry')}
      </Button>
    </div>
  );
}
