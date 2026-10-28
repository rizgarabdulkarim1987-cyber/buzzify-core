'use client';

import { Download, Printer } from 'lucide-react';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { statementCsv, type CsvRow } from './purchasing-money-logic';

/**
 * Print (the browser's print stylesheet; the screen controls are hidden in print) and Download CSV, built here from the rows
 * on screen: amounts with the currency's own digits and no grouping, a UTF-8 BOM so a spreadsheet reads Arabic.
 */
export function StatementActions({
  rows,
  currency,
  opening,
  closing,
  fileName,
}: {
  rows: CsvRow[];
  currency: 'IQD' | 'USD';
  opening: string | undefined;
  closing: string | undefined;
  fileName: string;
}) {
  const t = useT();
  useLocale();
  const download = () => {
    const csv = statementCsv(
      rows,
      currency,
      { date: t('pharmacy.purchasing.m.st.col.date'), ref: t('pharmacy.purchasing.m.st.col.ref'), kind: t('pharmacy.purchasing.m.st.col.kind'), amount: t('pharmacy.purchasing.m.st.col.amount'), balance: t('pharmacy.purchasing.m.st.col.balance') },
      { ...(opening !== undefined ? { opening } : {}), ...(closing !== undefined ? { closing } : {}), openingLabel: t('pharmacy.purchasing.m.st.opening'), closingLabel: t('pharmacy.purchasing.m.st.closing') },
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button size="lg" className="min-h-11" icon={<Printer aria-hidden />} data-testid="statement-print" onClick={() => window.print()}>
        {t('pharmacy.purchasing.m.st.print')}
      </Button>
      <Button size="lg" className="min-h-11" icon={<Download aria-hidden />} data-testid="statement-csv" onClick={download}>
        {t('pharmacy.purchasing.m.st.csv')}
      </Button>
    </div>
  );
}
