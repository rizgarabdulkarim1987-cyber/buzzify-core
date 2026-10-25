import type { Metadata } from 'next';
import Link from 'next/link';
import { formatStamp } from '@/lib/pos-format';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posInventoryItem } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { ItemSettingsForm, MovementForms } from '@/app/pos/_ui/stock/InventoryForms';
import { moneyLabel, quantityLabel, StockState } from '@/app/pos/_ui/stock/view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.stock.title') };
}

/** One item: what is held, the forms to adjust it and the ledger of every movement. Needs `inventory.manage`. */
export default async function InventoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ item, movements }, access, locale] = await Promise.all([query(posInventoryItem, { itemId: id }), getPosAccess(), requestStudioLocale()]);
  const role = access.actor?.role ?? 'CASHIER';
  const manage = canPos(role, 'inventory.manage');
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader
        above={
          <Link href="/pos/inventory" className="inline-flex min-h-12 items-center text-base text-muted underline underline-offset-2">
            {t('pos.stock.back')}
          </Link>
        }
        title={<span dir="auto">{item.name}</span>}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span>{t('pos.stock.held')}: {quantityLabel(t, item.onHand, item.unit)}</span>
            <StockState t={t} state={item.state} />
            {item.lastCost ? <span>{t('pos.stock.lastCost')}: {moneyLabel(t, item.lastCost.amount)} / {quantityLabel(t, item.lastCost.quantity, item.unit)}</span> : null}
          </span>
        }
      />
      <div className="flex flex-col gap-8 px-8 pb-8">
        {manage ? (
          <>
            <MovementForms itemId={item.id} unit={item.unit} />
            <section aria-labelledby="stock-settings" className="flex flex-col gap-3 border-t border-line pt-6">
              <h2 id="stock-settings" className="text-base font-semibold text-text">
                {t('pos.stock.settings')}
              </h2>
              <ItemSettingsForm itemId={item.id} name={item.name} active={item.active} unit={item.unit} reorderLevel={item.reorderLevel} />
            </section>
          </>
        ) : null}
        <section aria-labelledby="stock-ledger" className="flex flex-col gap-3 border-t border-line pt-6">
          <h2 id="stock-ledger" className="text-base font-semibold text-text">
            {t('pos.stock.ledger')}
          </h2>
          {movements.length === 0 ? (
            <p className="text-base text-muted">{t('pos.stock.ledgerNone')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {movements.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base text-text">{t(`pos.stock.kind.${m.kind}`)}</span>
                    <span className="text-sm text-muted" dir="auto">
                      {formatStamp(m.at)} {m.userName ? `· ${m.userName}` : ''} {m.reason ? `· ${m.reason}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-base text-text" dir="ltr">
                      {m.quantity > 0 ? '+' : ''}
                      {quantityLabel(t, m.quantity, item.unit)}
                    </span>
                    {manage && (m.kind === 'WASTE' || m.kind === 'SALE') ? <span className="text-sm text-muted">{m.costTotal === null ? t('pos.stock.costUnknown') : moneyLabel(t, m.costTotal)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
