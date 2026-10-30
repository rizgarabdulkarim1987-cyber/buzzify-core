import { Lock, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { OtherBranchNotice } from '@/app/pharmacy/_ui/OtherBranchNotice';
import { PurchaseOrderEditor } from '@/app/pharmacy/_ui/PurchaseOrderEditor';
import { emptyPoDraft } from '@/app/pharmacy/_ui/purchasing-logic';
import { currencies } from '@/server/pharmacy/queries/prices';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { acceptedProposal, prefillLines } from '../../../assistant/prefill';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.po.new') };
}

/** A new draft order in the chosen branch. Needs a role that buys, an open pharmacy and one branch chosen. */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const g = await purchasingGate('pharmacy.purchasing.po.new', { href: '/pharmacy/purchasing/orders', labelKey: 'pharmacy.purchasing.po.back' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const raw = await searchParams;
  const head = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.po.new')} />;
  if (!g.writable.ok) {
    return (
      <>
        {head}
        <div className="px-4 pb-10 sm:px-8">{g.writeNotice}</div>
      </>
    );
  }
  if (access.place.branchId === null) {
    return (
      <>
        {head}
        <div className="px-4 pb-10 sm:px-8">
          <p data-testid="po-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.purchasing.po.pickBranch')}</span>
          </p>
        </div>
      </>
    );
  }
  const [currencyList, supplierPage] = await Promise.all([query(currencies, access.placeInput), query(suppliers, { ...access.placeInput, active: true })]);
  // Opened from an accepted assistant suggestion: the existing form, pre-filled with the products and quantities (the supplier and the costs are the person's to enter). Nothing is saved until Save.
  const found = await acceptedProposal(access.placeInput, typeof raw.proposal === 'string' ? raw.proposal : undefined, 'REORDER');
  // A suggestion of another branch is never filled into this branch's order: the person is told and switches branch deliberately.
  const otherBranch = found !== null && found.branchId !== access.place.branchId;
  const accepted = otherBranch ? null : found;
  let initial: ReturnType<typeof emptyPoDraft> | null = null;
  if (accepted && accepted.proposal.kind === 'REORDER') {
    const lines = await prefillLines(access.placeInput, accepted.proposal.lines);
    if (lines.length > 0) initial = { ...emptyPoDraft(`po-assistant-${accepted.id}`, currencyList[0] ?? 'IQD'), lines: lines.map((l, i) => ({ key: `a${i + 1}`, ...l, bonus: '', cost: '' })) };
  }
  return (
    <>
      {head}
      {otherBranch && <OtherBranchNotice t={t} />}
      {initial && (
        <p data-testid="assistant-prefill" className="mx-4 mb-3 flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text sm:mx-8">
          <Sparkles aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.assistant.prefillOrder')}</span>
        </p>
      )}
      <PurchaseOrderEditor
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branchId={access.place.branchId}
        branchName={access.place.branchName ?? ''}
        currencies={currencyList}
        suppliers={supplierPage.items.map((s) => ({ id: s.id, name: s.name, defaultCurrency: s.defaultCurrency }))}
        initial={initial}
        orderId={null}
        {...(accepted && initial ? { draftId: accepted.id } : {})}
      />
    </>
  );
}
