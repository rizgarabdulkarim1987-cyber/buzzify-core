import { Lock, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { TransferEditor } from '@/app/pharmacy/_ui/TransferEditor';
import { emptyTransferDraft } from '@/app/pharmacy/_ui/transfers-logic';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { acceptedProposal, prefillLines } from '../../../assistant/prefill';
import { transfersGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.transfers.new') };
}

/**
 * A new transfer request. Only a role that moves stock has this screen, and only while the pharmacy is open for writing;
 * the others get a sentence saying why. The form keeps its draft on this device under "new" for this person and pharmacy.
 */
export default async function NewTransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const g = await transfersGate('pharmacy.transfers.new', { href: '/pharmacy/stock/transfers', labelKey: 'pharmacy.transfers.back' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const raw = await searchParams;
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
  // Opened from an accepted assistant suggestion: the existing form, pre-filled. Nothing is saved until the person presses Save.
  const accepted = await acceptedProposal(access.placeInput, typeof raw.proposal === 'string' ? raw.proposal : undefined, 'TRANSFER');
  let prefill: { id: string; draft: ReturnType<typeof emptyTransferDraft> } | null = null;
  if (accepted && accepted.proposal.kind === 'TRANSFER') {
    const lines = await prefillLines(access.placeInput, accepted.proposal.lines);
    if (lines.length > 0) {
      const draft = emptyTransferDraft(`tr-assistant-${accepted.id}`, 'send', accepted.proposal.fromBranchId, accepted.proposal.toBranchId);
      prefill = { id: accepted.id, draft: { ...draft, lines: lines.map((l, i) => ({ key: `a${i + 1}`, ...l })) } };
    }
  }
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.transfers.new')} description={t('pharmacy.transfers.newIntro')} above={g.back} />
      {prefill && (
        <p data-testid="assistant-prefill" className="mx-4 mb-3 flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text sm:mx-8">
          <Sparkles aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.assistant.prefill')}</span>
        </p>
      )}
      <TransferEditor
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branches={branches}
        reach={g.reach}
        placeBranchId={access.place.branchId}
        edit={null}
        prefill={prefill}
      />
    </>
  );
}
