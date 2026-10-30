'use client';

import { CircleAlert, CircleCheck, CircleX, ExternalLink, Lock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { acceptProposal, dismissProposal } from '@/app/pharmacy/_actions/assistant';
import type { ProposalInput } from '@/server/domain/pharmacy/assistant-domain';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { DRAFT_HREF, type ProposalStateKey } from './assistant-logic';
import { phDate } from './ph-date';
import { phMessage } from './ph-failure';
import { Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import type { Writable } from './WriteBlocked';

/**
 * Accept or dismiss one suggestion. One decision wins: a suggestion that was decided meanwhile (by someone else, or by a second click) is
 * shown as decided, with the reason in words. Accepting only marks it accepted and opens the EXISTING draft form pre-filled: nothing else
 * is created. A decided suggestion keeps a link to open the draft again, and shows no decision button. In read-only mode no button is drawn.
 */
export function ProposalActions({ proposalId, kind, state, decidedAt, writable }: { proposalId: string; kind: ProposalInput['kind']; state: ProposalStateKey; decidedAt: string | null; writable: Writable }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const draft = `${DRAFT_HREF[kind]}?proposal=${encodeURIComponent(proposalId)}`;

  const decide = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await settle(() => (accept ? acceptProposal({ proposalId }) : dismissProposal({ proposalId })));
    if (!result.ok) {
      setProblem(phMessage(t, locale, result.error, 'pharmacy.assistant'));
      setBusy(false);
      // Decided by someone else meanwhile: show it as decided.
      if (result.error.fields?.phCode === 'PROPOSAL_DECIDED') router.refresh();
      return;
    }
    if (accept) {
      router.push(draft);
      return;
    }
    router.refresh();
    setBusy(false);
  };

  if (state !== 'open') {
    return (
      <div className="flex flex-col gap-3" data-testid="proposal-decided" data-state={state}>
        <Note icon={state === 'accepted' ? <CircleCheck aria-hidden /> : <CircleX aria-hidden />} role="status">
          {t(`pharmacy.assistant.decided.${state}`, { date: decidedAt ? phDate(decidedAt, locale) : '' })}
        </Note>
        {state === 'accepted' && (
          <Link href={draft} data-testid="proposal-open-draft" className={`${TOUCH_BTN} w-fit`}>
            <ExternalLink aria-hidden className="size-4 rtl:-scale-x-100" />
            {t(`pharmacy.assistant.openDraft.${kind}`)}
          </Link>
        )}
      </div>
    );
  }
  if (!writable.ok) {
    return (
      <p data-testid="proposal-write-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
        <Lock aria-hidden className="text-muted" />
        <span className="min-w-0">{writable.reason === 'readOnly' ? t('pharmacy.assistant.blocked.readOnly', { date: phDate(writable.until, locale) }) : t(`pharmacy.assistant.blocked.${writable.reason}`)}</span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {problem && (
        <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="proposal-problem">
          {problem}
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={TOUCH_PRIMARY} disabled={busy} data-testid="proposal-accept" onClick={() => void decide(true)}>
          <CircleCheck aria-hidden className="size-4" />
          {t(`pharmacy.assistant.accept.${kind}`)}
        </button>
        <button type="button" className={TOUCH_BTN} disabled={busy} data-testid="proposal-dismiss" onClick={() => void decide(false)}>
          <CircleX aria-hidden className="size-4" />
          {t('pharmacy.assistant.dismiss')}
        </button>
      </div>
    </div>
  );
}
