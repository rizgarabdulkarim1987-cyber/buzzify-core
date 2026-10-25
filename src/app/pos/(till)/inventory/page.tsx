import type { Metadata } from 'next';
import Link from 'next/link';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posInventoryItems, posLowStock } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { AddItemForm } from '@/app/pos/_ui/stock/InventoryForms';
import { moneyLabel, quantityLabel, SectionTabs, StockState } from '@/app/pos/_ui/stock/view';
import { stockTabs } from './tabs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.stock.title') };
}

/** What the restaurant holds, and what is running out. A cashier sees quantities only; costs and forms need more. */
export default async function InventoryPage() {
  const [access, locale] = await Promise.all([getPosAccess(), requestStudioLocale()]);
  const role = access.actor?.role ?? 'CASHIER';
  const manage = canPos(role, 'inventory.manage');
  const [items, low] = await Promise.all([query(posInventoryItems, { includeInactive: manage }), query(posLowStock, {})]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.stock.title')} description={t('pos.stock.intro')} />
      <SectionTabs label={t('pos.stock.sections')} current="items" items={stockTabs(t, role)} />
      <div className="flex flex-col gap-8 px-8 pb-8">
        <section aria-labelledby="stock-low" className="flex flex-col gap-3">
          <h2 id="stock-low" className="text-base font-semibold text-text">
            {t('pos.stock.lowTitle')}
          </h2>
          {low.length === 0 ? (
            <p className="text-base text-muted">{t('pos.stock.lowNone')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {low.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate text-base text-text" dir="auto">
                    {item.name}
                  </span>
                  <span className="flex items-center gap-3">
                    <StockState t={t} state={item.state} />
                    <span className="text-base text-text">{quantityLabel(t, item.onHand, item.unit)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="stock-items" className="flex flex-col gap-3">
          <h2 id="stock-items" className="text-base font-semibold text-text">
            {t('pos.stock.itemsTitle')}
          </h2>
          {items.length === 0 ? (
            <EmptyState title={t('pos.stock.empty')} body={manage ? t('pos.stock.emptyBody') : undefined} />
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {items.map((item) => {
                const body = (
                  <>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-base text-text" dir="auto">
                        {item.name}
                      </span>
                      {item.lastCost ? <span className="text-sm text-muted">{t('pos.stock.lastCost')}: {moneyLabel(t, item.lastCost.amount)} / {quantityLabel(t, item.lastCost.quantity, item.unit)}</span> : null}
                    </span>
                    <span className="flex items-center gap-3">
                      {!item.active ? <span className="text-sm text-muted">{t('pos.stock.inactive')}</span> : null}
                      <StockState t={t} state={item.state} />
                      <span className="text-base text-text">{quantityLabel(t, item.onHand, item.unit)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={item.id}>
                    {manage ? (
                      <Link href={`/pos/inventory/${item.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-hover">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {manage ? <AddItemForm /> : null}
      </div>
    </>
  );
}
