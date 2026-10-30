'use client';

import { CircleAlert, Package, Plus, Printer, Settings2, Tag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { receiptProduct } from '@/app/pharmacy/_actions/receipts';
import { stockBalances } from '@/app/pharmacy/_actions/stock';
import { LABEL_SIZES, settingsOfWorkstation, type LabelSize, type PrintSettings } from '@/server/domain/pharmacy/print-settings';
import type { ProductDetail } from '@/server/pharmacy/products';
import type { SearchResult } from '@/server/pharmacy/search';
import type { ProductBalance } from '@/server/pharmacy/stock-reads';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { LabelView } from './LabelView';
import { OfflineNotice } from './OfflineNotice';
import { expandLabels, labelCss, LABEL_BOX, MAX_LABELS, MAX_PER_ITEM, safeQty, type LabelItem } from './print-logic';
import { ReceiptProductPicker } from './ReceiptProductPicker';
import { FIELD, FieldInput, FieldSelect, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { useWorkstation } from './use-workstation';

interface Current {
  productId: string;
  name: string;
  strength: string;
  form: string;
  barcode: string | null;
  price: LabelItem['price'];
  batches: Array<{ batchId: string; lot: string; expiryDate: string }>;
}

type QueueItem = LabelItem & { qtyText: string };
const PREVIEW = 6;

/**
 * Label sheets: pick products from the catalog (or a batch of stock), choose how many labels of each, see the labels at their printed size and
 * print them with the browser's print dialog on the label printer's paper. Shelf labels carry the name, strength, price (only where the person
 * and the workstation settings allow it) and the barcode; batch labels carry the batch and expiry instead of the price. Reading only: nothing
 * here changes stock or any record, so it works while the pharmacy is read-only. No motion.
 */
export function LabelWorkspace({ print, mayPrice }: { print: PrintSettings; mayPrice: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const boxRef = useRef<HTMLDivElement>(null);
  const [workstation] = useWorkstation();
  const settings = settingsOfWorkstation(print, workstation ?? '');
  const [sizeChoice, setSizeChoice] = useState<LabelSize | null>(null);
  const [priceChoice, setPriceChoice] = useState<boolean | null>(null);
  const size = sizeChoice ?? settings.labelSize;
  const showPrice = mayPrice && (priceChoice ?? settings.showPrice);
  const [current, setCurrent] = useState<Current | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);

  const pick = async (found: SearchResult): Promise<string | null> => {
    setProblem(null);
    const [detail, stock] = await Promise.all([settle(() => receiptProduct({ productId: found.productId })), settle(() => stockBalances({ productId: found.productId, pageSize: 1 }))]);
    if (!detail.ok) return describeFailure(t, locale, detail.error).message;
    const product = detail.data as ProductDetail;
    const codes = [...product.barcodes].sort((a, b) => a.level - b.level);
    const rows = stock.ok ? ((stock.data as { items: ProductBalance[] }).items[0]?.batches ?? []) : [];
    setCurrent({
      productId: product.id,
      name: product.tradeName,
      strength: product.strength,
      form: product.form,
      barcode: codes[0]?.code ?? null,
      price: found.price && mayPrice ? { amountMinor: String(found.price.amount), currency: found.price.currency } : null,
      batches: rows.filter((b) => b.status === 'ACTIVE').map((b) => ({ batchId: b.batchId, lot: b.lot, expiryDate: b.expiryDate })),
    });
    return null;
  };

  const add = (batch: Current['batches'][number] | null) => {
    if (!current) return;
    const key = batch ? `b:${batch.batchId}` : `p:${current.productId}`;
    if (queue.some((q) => q.key === key)) {
      setProblem(t('pharmacy.print.labels.alreadyOn'));
      return;
    }
    setProblem(null);
    setQueue((q) => [
      ...q,
      {
        key,
        productId: current.productId,
        name: current.name,
        strength: current.strength,
        form: current.form,
        barcode: current.barcode,
        lot: batch?.lot ?? null,
        expiry: batch?.expiryDate ?? null,
        price: batch ? null : current.price,
        qty: 1,
        qtyText: '1',
      },
    ]);
  };

  const setQty = (key: string, qtyText: string) =>
    setQueue((q) => q.map((it) => (it.key === key ? { ...it, qtyText, qty: safeQty(qtyText) ?? it.qty } : it)));

  const invalid = queue.some((it) => safeQty(it.qtyText) === null);
  const { labels, truncated } = expandLabels(queue);
  const text = { noBarcode: t('pharmacy.print.labels.noBarcode'), tooNarrow: t('pharmacy.print.labels.tooNarrow'), lot: t('pharmacy.print.labels.lot'), expiry: t('pharmacy.print.labels.expiry') };

  const doPrint = () => {
    setPrintFailed(false);
    try {
      window.print();
    } catch {
      setPrintFailed(true);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="labels-page">
      <style>{labelCss(size)}</style>
      <div className="flex min-w-0 flex-col gap-5 print:hidden">
        <OfflineNotice />
        <p className="text-sm text-muted" data-testid="labels-workstation">
          {t('pharmacy.print.workstationNote', { name: workstation ?? t('pharmacy.print.workstationNone'), paper: settings.paper })}{' '}
          <Link href="/pharmacy/print/settings" className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-2">
            <Settings2 aria-hidden className="size-4" />
            {t('pharmacy.print.settings.link')}
          </Link>
        </p>

        <section className="flex flex-col gap-3 rounded-md border border-line p-3" aria-label={t('pharmacy.print.labels.pick')}>
          <h2 className="text-md font-semibold text-text">{t('pharmacy.print.labels.pick')}</h2>
          <ReceiptProductPicker boxRef={boxRef} onPick={pick} />
          {current && (
            <div className="flex flex-col gap-2 rounded-md border border-line-strong bg-surface p-3" data-testid="labels-current">
              <p className="flex items-center gap-2 text-sm font-medium text-text">
                <Package aria-hidden className="size-4 shrink-0 text-muted" />
                <bdi dir="auto">{current.name}</bdi>
                <span className="text-muted">
                  <bdi dir="auto">{[current.strength, current.form].filter((p) => p.trim() !== '').join(' · ')}</bdi>
                </span>
              </p>
              {current.barcode === null && <p className="text-sm text-muted">{t('pharmacy.print.labels.noBarcode')}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={TOUCH_BTN} onClick={() => add(null)} data-testid="labels-add-shelf">
                  <Plus aria-hidden className="size-4" />
                  {t('pharmacy.print.labels.addShelf')}
                </button>
              </div>
              {current.batches.length > 0 ? (
                <ul className="flex flex-col gap-1" aria-label={t('pharmacy.print.labels.batches')} data-testid="labels-batches">
                  {current.batches.map((b) => (
                    <li key={b.batchId} className="flex flex-wrap items-center gap-3 text-sm text-text">
                      <span>
                        {t('pharmacy.print.labels.lot')} <bdi dir="ltr">{b.lot}</bdi> · {t('pharmacy.print.labels.expiry')} <bdi dir="ltr">{b.expiryDate}</bdi>
                      </span>
                      <button type="button" className={TOUCH_BTN} onClick={() => add(b)} data-testid="labels-add-batch">
                        <Plus aria-hidden className="size-4" />
                        {t('pharmacy.print.labels.addBatch')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('pharmacy.print.labels.noBatches')}</p>
              )}
            </div>
          )}
          {problem && (
            <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="labels-problem">
              {problem}
            </Note>
          )}
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('pharmacy.print.labels.size')}>
            <FieldSelect className={`${FIELD} pe-8`} value={size} onChange={(event) => setSizeChoice(event.target.value as LabelSize)} data-testid="labels-size">
              {LABEL_SIZES.map((s) => (
                <option key={s} value={s}>
                  {t(`pharmacy.print.size.${s}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm text-text">
            <input type="checkbox" className="size-5" checked={showPrice} disabled={!mayPrice} onChange={(event) => setPriceChoice(event.target.checked)} data-testid="labels-price" />
            {t('pharmacy.print.labels.showPrice')}
          </label>
        </div>

        <section aria-label={t('pharmacy.print.labels.queue')} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-text">{t('pharmacy.print.labels.queue')}</h2>
          {queue.length === 0 ? (
            <Note icon={<Tag aria-hidden />} testId="labels-empty">
              {t('pharmacy.print.labels.empty')}
            </Note>
          ) : (
            <ul className="flex flex-col border-t border-line" data-testid="labels-queue">
              {queue.map((it) => {
                const bad = safeQty(it.qtyText) === null;
                return (
                  <li key={it.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-2" data-testid="labels-queue-item">
                    <span className="min-w-0 flex-1 text-sm text-text">
                      <bdi dir="auto">{it.name}</bdi>
                      {it.lot !== null && (
                        <span className="block text-xs text-muted">
                          {t('pharmacy.print.labels.lot')} <bdi dir="ltr">{it.lot}</bdi>
                        </span>
                      )}
                    </span>
                    <Field label={t('pharmacy.print.labels.qty')} {...(bad ? { error: t('pharmacy.print.labels.qtyBad', { max: MAX_PER_ITEM }) } : {})}>
                      <FieldInput inputMode="numeric" dir="ltr" className={`${FIELD} w-24`} value={it.qtyText} onChange={(event) => setQty(it.key, event.target.value)} data-testid="labels-qty" />
                    </Field>
                    <button type="button" className={TOUCH_BTN} onClick={() => setQueue((q) => q.filter((x) => x.key !== it.key))} aria-label={`${t('pharmacy.print.labels.remove')}: ${it.name}`} data-testid="labels-remove">
                      <Trash2 aria-hidden className="size-4" />
                      {t('pharmacy.print.labels.remove')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {truncated && (
            <Note icon={<CircleAlert aria-hidden />} tone="danger" role="status" testId="labels-truncated">
              {t('pharmacy.print.labels.truncated', { max: MAX_LABELS })}
            </Note>
          )}
        </section>

        {labels.length > 0 && (
          <section aria-label={t('pharmacy.print.labels.preview')} className="flex flex-col gap-2" data-testid="labels-preview">
            <h2 className="text-md font-semibold text-text">{t('pharmacy.print.labels.preview')}</h2>
            <p className="text-sm text-muted" data-testid="labels-page-size">
              {t('pharmacy.print.labels.pageSize', { w: LABEL_BOX[size].widthMm, h: LABEL_BOX[size].heightMm, n: labels.length })}
            </p>
            <div className="flex flex-wrap gap-3" dir="ltr">
              {labels.slice(0, PREVIEW).map((item, i) => (
                <div key={`${item.key}-${i}`} className="border border-neutral-400">
                  <LabelView item={item} size={size} showPrice={showPrice} labels={text} />
                </div>
              ))}
            </div>
            {labels.length > PREVIEW && <p className="text-sm text-muted">{t('pharmacy.print.labels.more', { n: labels.length - PREVIEW })}</p>}
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={TOUCH_PRIMARY} onClick={doPrint} disabled={labels.length === 0 || invalid} data-testid="labels-print">
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.print.labels.print')}
          </button>
        </div>
        {printFailed && (
          <Note icon={<Printer aria-hidden />} tone="danger" role="alert" testId="labels-print-failed">
            {t('pharmacy.sell.receipt.printFailed')}
          </Note>
        )}
        <p className="text-xs text-muted">{t('pharmacy.print.browserOnly')}</p>
      </div>

      {/* What the printer receives: every label on its own page of the label's size. Hidden on screen. */}
      <div className="hidden print:block" dir="ltr" data-testid="labels-sheet" aria-hidden="true">
        {labels.map((item, i) => (
          <LabelView key={`${item.key}-${i}`} item={item} size={size} showPrice={showPrice} labels={text} />
        ))}
      </div>
    </div>
  );
}
