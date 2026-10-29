import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { TransferEditor } from '@/app/pharmacy/_ui/TransferEditor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { transfersGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.transfers.new') };
}

/**
 * A new transfer request. Only a role that moves stock has this screen, and only while the pharmacy is open for writing;
 * the others get a sentence saying why. The form keeps its draft on this device under "new" for this person and pharmacy.
 */
export default async function NewTransferPage() {
  const g = await transfersGate('pharmacy.transfers.new', { href: '/pharmacy/stock/transfers', labelKey: 'pharmacy.transfers.back' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  if (!g.writable.ok) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.transfers.new')} above={g.back} />
        <div className="flex flex-col gap-4 px-4 pb-10 sm:px-8" data-testid="transfer-write-blocked">
          {g.writeNotice}
        </div>
      </>
    );
  }
  const branches = await g.branches();
  if (branches.length < 2) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.transfers.new')} above={g.back} />
        <div className="px-4 pb-10 sm:px-8">
          <p data-testid="transfer-one-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.transfers.oneBranch')}</span>
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.transfers.new')} description={t('pharmacy.transfers.newIntro')} above={g.back} />
      <TransferEditor
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branches={branches}
        reach={g.reach}
        placeBranchId={access.place.branchId}
        edit={null}
      />
    </>
  );
}
