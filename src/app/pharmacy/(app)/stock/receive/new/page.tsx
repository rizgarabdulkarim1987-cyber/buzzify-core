import { ArrowLeft, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { orderLineToReceiptLine } from '@/app/pharmacy/_ui/purchasing-logic';
import type { LineDraft } from '@/app/pharmacy/_ui/receipt-draft';
import { emptyDraft, newKey } from '@/app/pharmacy/_ui/receipt-draft';
import { ReceiptEditor } from '@/app/pharmacy/_ui/ReceiptEditor';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { currencies } from '@/server/pharmacy/queries/prices';
import { get as getProduct } from '@/server/pharmacy/queries/products';
import { get as getSupplier } from '@/server/pharmacy/queries/suppliers';
import { get as getOrder } from '@/server/pharmacy/queries/purchase-orders';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.receive.newTitle') };
}

/**
 * A new receipt. Only a role that receives goods has this screen, in the one branch the person chose; the others get a
 * sentence saying why. The form keeps its draft on this device under "new" for this person, pharmacy and branch.
 */
export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const orderParam = Array.isArray(raw.order) ? raw.order[0] : raw.order;
  const supplierParam = Array.isArray(raw.supplier) ? raw.supplier[0] : raw.supplier;
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place } = access;
  const back = (
    <Link href="/pharmacy/stock/receive" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t('pharmacy.receive.back')}
    </Link>
  );
  const writable = access.writable('purchase.manage');
  if (!roleMay(actor, 'purchase.manage') || !writable.ok) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.receive.newTitle')} above={back} />
        <div className="flex flex-col gap-4 px-4 pb-10 sm:px-8" data-testid="receive-forbidden">
          {!writable.ok && <ReceiveBlocked reason={writable.reason} t={t} />}
          <EmptyState icon={<Lock />} title={t('pharmacy.receive.forbidden.title')} body={t('pharmacy.receive.forbidden.role')} />
        </div>
      </>
    );
  }
  if (place.branchId === null) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.receive.newTitle')} above={back} />
        <div className="px-4 pb-10 sm:px-8">
          <p data-testid="receive-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.receive.pickBranch')}</span>
          </p>
        </div>
      </>
    );
  }
  const currencyList = await query(currencies, access.placeInput);
  if (orderParam && /^[\w-]{1,64}$/.test(orderParam)) {
    const order = await query(getOrder, { ...access.placeInput, purchaseOrderId: orderParam });
    const open = order.status === 'ORDERED' || order.status === 'PARTIAL';
    if (!open || order.branchId !== place.branchId) {
      return (
        <>
          <PageHeader className="max-sm:px-4" title={t('pharmacy.receive.newTitle')} above={back} />
          <div className="px-4 pb-10 sm:px-8">
            <p data-testid="receive-order-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
              <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
              <span className="min-w-0">{t(open ? 'pharmacy.purchasing.receive.wrongBranch' : 'pharmacy.purchasing.receive.notOpen')}</span>
            </p>
          </div>
        </>
      );
    }
    const productIds = [...new Set(order.lines.map((l) => l.productId))];
    const details = await Promise.all(productIds.map((productId) => query(getProduct, { ...access.placeInput, productId })));
    const byId = new Map(details.map((p) => [p.id, p]));
    const lines: LineDraft[] = [];
    for (const l of order.lines) {
      const start = orderLineToReceiptLine(l, order.currency);
      const p = byId.get(l.productId);
      if (!start || !p) continue;
      lines.push({
        key: `o${l.lineNo}`,
        productId: l.productId,
        productName: l.productName,
        productMeta: [p.strength, p.form].filter((x) => x.trim() !== '').join(' · '),
        units: [...p.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty })),
        unitId: start.unitId,
        qty: start.qty,
        bonusQty: start.bonusQty,
        lot: '',
        expiry: '',
        cost: start.cost,
        currency: start.currency,
        freeOfCharge: false,
        acceptExpired: false,
        purchaseOrderLineId: start.purchaseOrderLineId,
      });
    }
    const initial = {
      ...emptyDraft(newKey(), utcToday()),
      supplierName: order.supplierName,
      supplierId: order.supplierId,
      purchaseOrderId: order.id,
      purchaseOrderNumber: order.number ?? '',
      lines,
    };
    return (
      <ReceiptEditor
        userId={actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branchId={place.branchId}
        branchName={place.branchName ?? ''}
        initial={initial}
        receiptId={null}
        currencies={currencyList}
        draftScope={`order-${order.id}`}
      />
    );
  }
  // "Enter it by hand" from an invoice batch arrives with the batch's supplier; one that is unknown, archived or malformed is ignored.
  const supplier = supplierParam && /^[\w-]{1,64}$/.test(supplierParam) ? await query(getSupplier, { ...access.placeInput, supplierId: supplierParam }).catch(() => null) : null;
  const chosen = supplier && supplier.active ? supplier : null;
  return (
    <ReceiptEditor
      userId={actor.userId}
      restaurantId={access.placeInput.restaurantId}
      branchId={place.branchId}
      branchName={place.branchName ?? ''}
      initial={chosen ? { ...emptyDraft(newKey(), utcToday()), supplierName: chosen.name, supplierId: chosen.id } : null}
      receiptId={null}
      currencies={currencyList}
      draftScope={chosen ? `supplier-${chosen.id}` : undefined}
    />
  );
}
