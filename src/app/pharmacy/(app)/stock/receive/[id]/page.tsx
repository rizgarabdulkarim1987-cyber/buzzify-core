import { ArrowLeft, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { ReceiptEditor } from '@/app/pharmacy/_ui/ReceiptEditor';
import { draftOfReceipt, type UnitChoice } from '@/app/pharmacy/_ui/receipt-draft';
import { ReceiptView } from '@/app/pharmacy/_ui/ReceiptView';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { currencies } from '@/server/pharmacy/queries/prices';
import { get as getProduct } from '@/server/pharmacy/queries/products';
import { get as getReceipt } from '@/server/pharmacy/queries/receipts';
import { movements } from '@/server/pharmacy/queries/stock';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.receive.title') };
}

/**
 * One receipt. A draft opens in the editor for a role that receives goods, in the branch it was made for; everything else
 * is a read-only view: a confirmed or void receipt, a draft seen by someone who may only look. A confirmed receipt lists
 * the stock changes it made for the roles that read the ledger. Cost shows only if the server sent it.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, locale, places] = await Promise.all([params, catalogAccess(), requestStudioLocale(), getPhPlaces()]);
  const t = getStudioTranslator(locale);
  const { actor } = access;
  const back = (
    <Link href="/pharmacy/stock/receive" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t('pharmacy.receive.back')}
    </Link>
  );
  if (actor.role === null) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.receive.title')} above={back} />
        <div data-testid="receive-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.receive.forbidden.title')} body={t('pharmacy.receive.forbidden.support')} />
        </div>
      </>
    );
  }
  if (!/^[\w-]{1,64}$/.test(id)) notFound();

  const receipt = await query(getReceipt, { ...access.placeInput, receiptId: id });
  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  const branchName = branches.find((b) => b.id === receipt.branchId)?.name ?? '';
  const writable = access.writable('purchase.manage');
  const mayReceive = roleMay(actor, 'purchase.manage');
  const editable = receipt.status === 'DRAFT' && writable.ok && access.place.branchId === receipt.branchId;

  if (editable && access.place.branchId) {
    const productIds = [...new Set(receipt.lines.map((l) => l.productId))];
    const [details, currencyList] = await Promise.all([
      Promise.all(productIds.map((productId) => query(getProduct, { ...access.placeInput, productId }))),
      query(currencies, access.placeInput),
    ]);
    const unitsOf: Record<string, { meta: string; units: UnitChoice[] }> = {};
    for (const p of details) {
      unitsOf[p.id] = {
        meta: [p.strength, p.form].filter((x) => x.trim() !== '').join(' · '),
        units: [...p.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty })),
      };
    }
    return (
      <ReceiptEditor
        userId={actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branchId={access.place.branchId}
        branchName={branchName}
        initial={draftOfReceipt(receipt, unitsOf, currencyList[0] ?? 'IQD')}
        receiptId={receipt.id}
        currencies={currencyList}
      />
    );
  }

  const moves =
    receipt.status === 'CONFIRMED' && roleMay(actor, 'report.view')
      ? (await query(movements, { ...access.placeInput, receiptId: receipt.id, pageSize: 100 })).items
      : null;
  const reason =
    receipt.status !== 'DRAFT'
      ? null
      : !mayReceive || !writable.ok
        ? writable.ok
          ? ('role' as const)
          : writable.reason
        : ('branch' as const);

  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={back}
        title={receipt.number ? t('pharmacy.receive.viewTitle', { number: receipt.number }) : t('pharmacy.receive.viewDraftTitle')}
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {reason === 'branch' ? (
          <p data-testid="receive-wrong-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.receive.wrongBranch', { branch: branchName })}</span>
          </p>
        ) : reason ? (
          <ReceiveBlocked reason={reason} t={t} />
        ) : null}
        <OfflineNotice />
        <ReceiptView receipt={receipt} movements={moves} branchName={branchName} t={t} locale={locale} />
      </div>
    </>
  );
}
