import { ScanBarcode } from 'lucide-react';
import Link from 'next/link';
import type { Translate } from '@/lib/i18n';

/** A receipt made by fast product entry, in the receiving list: icon and word, next to its state. */
export function FastEntryBadge({ t }: { t: Translate }) {
  return (
    <span
      data-testid="receipt-fast-entry"
      className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      <ScanBarcode aria-hidden />
      {t('pharmacy.receive.fastEntry')}
    </span>
  );
}

/**
 * On a fast-entry draft opened from the receiving list: it is someone's entry in progress, finished from the entry screen
 * (voiding it here ends that person's entry: their next line opens a new draft).
 */
export function FastEntryNote({ t }: { t: Translate }) {
  return (
    <p data-testid="receipt-fast-entry-note" className="flex flex-wrap items-start gap-x-2.5 gap-y-1 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
      <ScanBarcode aria-hidden className="text-muted" />
      <span className="min-w-0 flex-1">{t('pharmacy.receive.fastEntryNote')}</span>
      <Link href="/pharmacy/stock/entry" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">
        {t('pharmacy.receive.fastEntryOpen')}
      </Link>
    </p>
  );
}
