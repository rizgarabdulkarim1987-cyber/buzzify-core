'use client';

import { toast } from 'sonner';
import { ensurePosMenuTables } from '@/app/studio/_actions/pos';
import { formatNumber } from '@/lib/pos-format';
import type { QrSheetView } from '@/server/pos/qr-sheet';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { usePosCall } from './use-pos-call';

/**
 * A card per table with its code, printable four to an A4 page. The codes are drawn on the server (no remote service); the
 * address under each is the Menu's own, so it can be typed by hand if a code is damaged.
 */
export function QrSheet({ sheet }: { sheet: QrSheetView }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const missing = sheet.tables.filter((table) => !table.hasMenuPage).length;

  if (sheet.tables.length === 0) return <EmptyState title={t('pos.qr.noTables')} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden flex flex-wrap gap-2">
        <Button variant="primary" size="lg" className="min-h-12" onClick={() => window.print()}>
          {t('pos.qr.print')}
        </Button>
        {missing > 0 ? (
          <Button
            variant="secondary"
            size="lg"
            className="min-h-12"
            disabled={pending}
            onClick={() => void call(() => ensurePosMenuTables({}), { onOk: (data) => toast.success(t('pos.qr.created', { n: formatNumber(data.created) })) })}
          >
            {t('pos.qr.createPages')}
          </Button>
        ) : null}
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4 print:grid-cols-2 print:gap-8">
        {sheet.tables.map((table) => (
          <li key={table.id} className="flex break-inside-avoid flex-col items-center gap-2 rounded-lg border border-line-strong bg-raised p-4 text-center print:min-h-[11cm] print:justify-center print:border-0">
            <p className="text-sm text-muted print:text-base">{t('pos.qr.scan')}</p>
            <p className="text-3xl font-semibold text-text print:text-5xl">{t('pos.qr.table', { n: formatNumber(table.number) })}</p>
            {table.svg ? (
              <div role="img" aria-label={t('pos.qr.table', { n: formatNumber(table.number) })} className="w-full max-w-48 print:max-w-72 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: table.svg }} />
            ) : null}
            <p className="break-all text-xs text-muted" dir="ltr">
              {table.url}
            </p>
            {!table.hasMenuPage ? <p className="print:hidden text-sm text-danger">{t('pos.qr.noPage')}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
