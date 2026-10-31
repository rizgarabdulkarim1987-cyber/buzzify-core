'use client';

import { CircleAlert, RotateCcw } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';

/** The sale screen failed to load: what happened, that nothing changed, and the way to try again. */
export default function SellError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 px-4 py-10 sm:px-8">
      <p className="flex items-center gap-2.5 text-md font-semibold text-text">
        <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />
        {t('pharmacy.sell.loadFailed')}
      </p>
      <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.sell.loadFailedBody')}</p>
      <Button size="lg" className="min-h-11" icon={<RotateCcw aria-hidden />} onClick={() => reset()}>
        {t('pharmacy.sell.retry')}
      </Button>
    </div>
  );
}
