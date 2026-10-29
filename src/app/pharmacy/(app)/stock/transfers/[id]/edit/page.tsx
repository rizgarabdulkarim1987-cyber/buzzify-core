import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { newKey } from '@/app/pharmacy/_ui/receipt-draft';
import { TransferEditor } from '@/app/pharmacy/_ui/TransferEditor';
import { mayAt, type TransferDraft } from '@/app/pharmacy/_ui/transfers-logic';
import { get as getProduct } from '@/server/pharmacy/queries/products';
import { get } from '@/server/pharmacy/queries/transfers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { transfersGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.transfers.edit') };
}

/** Edits a transfer that is still REQUESTED: its note and lines (the two branches stay). Either end may. */
export default async function EditTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, transfersGate('pharmacy.transfers.edit', { href: '/pharmacy/stock/transfers', labelKey: 'pharmacy.transfers.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, reach } = g;
  const transfer = await query(get, { ...access.placeInput, transferId: id });
  const head = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.transfers.edit')} />;
  const reason = !g.writable.ok ? null : transfer.status !== 'REQUESTED' ? 'pharmacy.transfers.edit.notRequested' : !mayAt(reach, transfer.fromBranchId) && !mayAt(reach, transfer.toBranchId) ? 'pharmacy.transfers.edit.notYours' : null;
  if (!g.writable.ok || reason) {
    return (
      <>
        {head}
        <div className="flex flex-col gap-4 px-4 pb-10 sm:px-8">
          {g.writeNotice}
          {reason && (
            <p data-testid="transfer-edit-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
              <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
              <span className="min-w-0">{t(reason)}</span>
            </p>
          )}
        </div>
      </>
    );
  }
  const productIds = [...new Set(transfer.requestLines.map((l) => l.productId))];
  const details = await Promise.all(productIds.map((productId) => query(getProduct, { ...access.placeInput, productId })));
  const byId = new Map(details.map((p) => [p.id, p]));
  const lines = transfer.requestLines.map((l, i) => {
    const p = byId.get(l.productId);
    const units = p ? [...p.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty })) : [];
    return {
      key: `l${i + 1}`,
      productId: l.productId,
      productName: l.productName,
      productMeta: p ? [p.strength, p.form].filter((x) => x.trim() !== '').join(' · ') : '',
      units,
      unitId: units[0]?.id ?? '',
      qty: String(l.requestedQty),
    };
  });
  const draft: TransferDraft = {
    version: transfer.version,
    clientKey: newKey(),
    mode: mayAt(reach, transfer.fromBranchId) ? 'send' : 'request',
    mineId: mayAt(reach, transfer.fromBranchId) ? transfer.fromBranchId : transfer.toBranchId,
    otherId: mayAt(reach, transfer.fromBranchId) ? transfer.toBranchId : transfer.fromBranchId,
    note: transfer.note,
    lines,
  };
  const branches = [
    { id: transfer.fromBranchId, name: transfer.fromBranchName },
    { id: transfer.toBranchId, name: transfer.toBranchName },
  ];
  return (
    <>
      {head}
      <TransferEditor
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branches={branches}
        reach={reach}
        placeBranchId={access.place.branchId}
        edit={{ id: transfer.id, version: transfer.version, draft }}
      />
    </>
  );
}
