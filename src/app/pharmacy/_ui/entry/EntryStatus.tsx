'use client';

import type { ReactNode } from 'react';
import { useLocale, useT } from '@/studio/i18n';
import { phDate } from '../ph-date';
import { PH_BTN } from '../sell-parts';
import type { EntryTargetState } from './use-entry';

const PILL = 'rounded-full bg-ph-card px-2.5 py-0.5 text-xs font-semibold text-ph-text';

/**
 * The status line under the scan field (the prototype's `.state`): idle (or what was just saved), looking up, a known
 * product with its ingredient, prescription and last purchase, a new product with its barcode, or several matches to choose
 * from. A role that cannot add products is told so instead of the new form.
 */
export function EntryStatus({ target, onPick }: { target: EntryTargetState; onPick: (productId: string) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const tone =
    target.kind === 'known'
      ? 'bg-ph-g1 font-bold text-ph-g8'
      : target.kind === 'new' && target.canCreate
        ? 'bg-ph-blue-wash font-bold text-ph-blue'
        : target.kind === 'new'
          ? 'bg-ph-amber-wash font-semibold text-ph-amber-ink'
          : 'bg-ph-canvas font-medium text-ph-muted';

  let body: ReactNode;
  if (target.kind === 'idle') {
    const note = target.note;
    body =
      note === 'start'
        ? t('pharmacy.entry.state.idle')
        : note === 'ready'
          ? t('pharmacy.entry.state.ready')
          : t(note.replayed ? 'pharmacy.entry.state.replayed' : 'pharmacy.entry.state.saved', { name: note.name });
  } else if (target.kind === 'loading') {
    body = t('pharmacy.entry.state.loading');
  } else if (target.kind === 'known') {
    const { product, lastPurchase } = target.found;
    body = (
      <>
        <span>{t('pharmacy.entry.state.known')}</span>
        <b dir="auto">{product.tradeName}</b>
        {product.activeIngredient.trim() !== '' && (
          <span className={PILL} dir="auto">
            {product.activeIngredient}
          </span>
        )}
        {product.rxLevel !== 'OTC' && <span className="rounded-full bg-ph-red-wash px-2.5 py-0.5 text-xs font-semibold text-ph-red">{t('pharmacy.entry.state.rx')}</span>}
        {lastPurchase && <span className={PILL}>{t('pharmacy.entry.state.lastBuy', { date: phDate(lastPurchase.receivedOn, locale) })}</span>}
      </>
    );
  } else if (target.kind === 'new') {
    body = target.canCreate ? (
      <>
        <span>{target.barcode ? t('pharmacy.entry.state.new') : t('pharmacy.entry.state.newByName')}</span>
        {target.barcode && (
          <b dir="ltr" className="tabular-nums">
            {target.barcode}
          </b>
        )}
        <span className={`${PILL} font-medium`}>{t('pharmacy.entry.state.newHint')}</span>
      </>
    ) : (
      t('pharmacy.entry.state.noCreate')
    );
  } else {
    body = t('pharmacy.entry.state.choose');
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="status" data-testid="entry-status" data-state={target.kind} className={`flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-ph-xl px-3.5 py-2 text-sm ${tone}`}>
        {body}
      </div>
      {target.kind === 'choose' && (
        <ul className="flex flex-wrap gap-2">
          {target.candidates.map((c) => (
            <li key={c.productId}>
              <button type="button" data-testid="entry-candidate" className={PH_BTN} onClick={() => onPick(c.productId)}>
                <span dir="auto">{c.tradeName}</span>
                <span className="text-xs font-medium text-ph-muted">{c.packLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
