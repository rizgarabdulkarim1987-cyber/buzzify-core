import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PurchaseOrderEditor } from '@/app/pharmacy/_ui/PurchaseOrderEditor';
import { minorToText } from '@/app/pharmacy/_ui/receipt-draft';
import type { PoDraft } from '@/app/pharmacy/_ui/purchasing-logic';
import { currencies } from '@/server/pharmacy/queries/prices';
import { get as getProduct } from '@/server/pharmacy/queries/products';
import { get } from '@/server/pharmacy/queries/purchase-orders';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.po.edit') };
}

/** Edits a DRAFT order in its own branch. Cost is needed to edit (the form shows each line's cost). */
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.purchasing.po.edit', { href: '/pharmacy/purchasing/orders', labelKey: 'pharmacy.purchasing.po.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t } = g;
  const order = await query(get, { ...access.placeInput, purchaseOrderId: id });
  const head = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.po.edit')} />;
  const reason = !g.writable.ok
    ? null
    : order.status !== 'DRAFT'
      ? 'pharmacy.purchasing.po.notDraft'
      : access.place.branchId !== order.branchId
        ? 'pharmacy.purchasing.po.wrongBranch'
        : order.lines.some((l) => l.unitCostMinor === undefined)
          ? 'pharmacy.purchasing.po.needsCost'
          : null;
  if (!g.writable.ok || reason) {
    return (
      <>
        {head}
        <div className="px-4 pb-10 sm:px-8">
          {g.writeNotice}
          {reason && (
            <p data-testid="po-edit-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
              <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
              <span className="min-w-0">{t(reason)}</span>
            </p>
          )}
        </div>
      </>
    );
  }
  const productIds = [...new Set(order.lines.map((l) => l.productId))];
  const [details, currencyList, supplierPage] = await Promise.all([
    Promise.all(productIds.map((productId) => query(getProduct, { ...access.placeInput, productId }))),
    query(currencies, access.placeInput),
    query(suppliers, { ...access.placeInput, active: true }),
  ]);
  const byId = new Map(details.map((p) => [p.id, p]));
  const initial: PoDraft = {
    version: order.version,
    clientKey: `po-${order.id}-${order.version}`,
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    currency: order.currency,
    expectedOn: order.expectedOn ?? '',
    note: order.note,
    lines: order.lines.map((l) => {
      const p = byId.get(l.productId);
      return {
        key: `l${l.lineNo}`,
        productId: l.productId,
        productName: l.productName,
        productMeta: p ? [p.strength, p.form].filter((x) => x.trim() !== '').join(' · ') : '',
        units: p ? [...p.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty })) : [{ id: l.unitId, label: l.unitLabel, baseQty: 1 }],
        unitId: l.unitId,
        qty: String(l.qtyOrdered),
        bonus: String(l.bonusOrdered),
        cost: minorToText(BigInt(l.unitCostMinor!), order.currency),
      };
    }),
  };
  return (
    <>
      {head}
      <PurchaseOrderEditor
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branchId={order.branchId}
        branchName={access.place.branchName ?? ''}
        currencies={currencyList}
        suppliers={supplierPage.items.map((s) => ({ id: s.id, name: s.name, defaultCurrency: s.defaultCurrency }))}
        initial={initial}
        orderId={order.id}
      />
    </>
  );
}
