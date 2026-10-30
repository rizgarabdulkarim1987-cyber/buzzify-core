import { ClipboardList, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { OtherBranchNotice } from '@/app/pharmacy/_ui/OtherBranchNotice';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { MoneyLocked } from '@/app/pharmacy/_ui/ReasonAction';
import { SupplierReturnForm } from '@/app/pharmacy/_ui/SupplierReturnForm';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { acceptedProposal } from '../../../assistant/prefill';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.ret.newTitle') };
}

/** Returning stock to a supplier from the chosen branch. Needs purchase.manage AND stock.adjust: a role without the second sees the blocked state. */
export default async function NewSupplierReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const g = await purchasingGate('pharmacy.purchasing.m.ret.newTitle', { href: '/pharmacy/purchasing/returns', labelKey: 'pharmacy.purchasing.m.ret.back' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const raw = await searchParams;
  const header = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.purchasing.m.ret.newTitle')} description={t('pharmacy.purchasing.m.ret.newIntro')} />;
  if (!g.writable.ok) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">{g.writeNotice ?? <ReceiveBlocked reason={g.writable.reason} t={t} />}</div>
      </>
    );
  }
  if (access.actor.role === null || !canPh(access.actor.role, 'stock.adjust')) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">
          <MoneyLocked testId="return-blocked" text={t('pharmacy.purchasing.m.ret.needsAdjust')} />
        </div>
      </>
    );
  }
  if (access.place.branchId === null) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">
          <p data-testid="return-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <ClipboardList aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.purchasing.m.ret.pickBranch')}</span>
          </p>
        </div>
      </>
    );
  }
  const page = await query(suppliers, { ...access.placeInput, active: true });
  // Opened from an accepted assistant suggestion: the lines it names are shown above the form, which is the same form as always.
  const found = await acceptedProposal(access.placeInput, typeof raw.proposal === 'string' ? raw.proposal : undefined, 'SUPPLIER_RETURN');
  const otherBranch = found !== null && found.branchId !== access.place.branchId;
  const accepted = otherBranch ? null : found;
  return (
    <>
      {header}
      {otherBranch && <OtherBranchNotice t={t} />}
      {accepted && (
        <p data-testid="assistant-prefill" className="mx-4 mb-3 flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text sm:mx-8">
          <Sparkles aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">
            {t('pharmacy.assistant.prefillReturn')}{' '}
            <Link href={`/pharmacy/assistant/proposals/${accepted.id}`} className="underline underline-offset-2">
              {t('pharmacy.assistant.prefillReturnLink')}
            </Link>
          </span>
        </p>
      )}
      <SupplierReturnForm
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branchId={access.place.branchId}
        branchName={access.place.branchName ?? ''}
        suppliers={page.items.map((s) => ({ id: s.id, name: s.name }))}
      />
    </>
  );
}
