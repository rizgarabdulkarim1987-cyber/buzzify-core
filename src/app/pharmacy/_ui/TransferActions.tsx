'use client';

import { Ban, Lock, PackageCheck, PencilLine, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { cancelTransfer } from '@/app/pharmacy/_actions/transfers';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { phMessage } from './ph-failure';
import { TransferFailure } from './TransferFailure';
import { isConflict, lostAnswer } from './transfers-failure';
import { TransferReceive, type ReceiveSentLine } from './TransferReceive';
import { TransferSend, type SendRequestRow } from './TransferSend';
import type { DetailControls } from './transfers-logic';
import { useOnline } from './use-online';
import { isolate } from './WriteBlocked';

export interface TransferActionsProps {
  userId: string;
  restaurantId: string;
  transfer: { id: string; version: number; status: 'REQUESTED' | 'SENT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED'; fromBranchId: string; toBranchId: string; fromBranchName: string; toBranchName: string };
  controls: DetailControls;
  perms: { override: boolean; reportView: boolean };
  today: string;
  requestRows: SendRequestRow[];
  sentRows: ReceiveSentLine[];
  /** The branch the person works in is not the sender's: the send needs them to switch (sentence shown instead of the button). */
  placeBranchName: string | null;
}

type Panel = null | 'cancel' | 'send' | 'receive';

/**
 * What can be done to a transfer in its state, by the branch the person works at: Edit and Cancel while REQUESTED (either
 * end), Send at the sender, Receive at the destination. Each change asks first and says what it does to the stock. Nothing is
 * fired by one tap; a refusal shows the server's sentence, translated. The version always comes from the page, which the
 * router refreshes after every change, so a second action never carries an old one.
 */
export function TransferActions(props: TransferActionsProps) {
  const { transfer, controls, perms } = props;
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const can = online && !pending;
  const lost = useRef(false);

  const cancel = async () => {
    if (pending) return;
    setPending(true);
    const result = await settle(() => cancelTransfer({ transferId: transfer.id, version: transfer.version }));
    setPending(false);
    if (!result.ok) {
      const code = result.error.fields?.phCode;
      // The cancel has no key: after a lost answer it may be done already, so refresh and say that (not "someone else").
      const maybeDone = lostAnswer(result.error) || (lost.current && isConflict(code));
      if (lostAnswer(result.error)) {
        lost.current = true;
        router.refresh();
      }
      setError({ message: maybeDone ? t('pharmacy.transfers.lostAnswer') : phMessage(t, locale, result.error, 'pharmacy.transfers'), stale: !maybeDone && isConflict(code) });
      return;
    }
    setError(null);
    setPanel(null);
    router.refresh();
  };

  if (controls.blocked) return null;
  const nothing = !controls.edit && !controls.cancel && controls.send === 'no' && controls.receive === 'no';
  if (nothing) return null;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="transfer-actions">
      {error && panel !== 'send' && panel !== 'receive' && <TransferFailure testId="transfer-action-error" message={error.message} stale={error.stale} onReload={() => {
          setError(null);
          router.refresh();
        }} />}
      <div className="flex flex-wrap items-center gap-2">
        {controls.send === 'yes' && (
          <Button variant="primary" size="lg" className="min-h-11" icon={<Send aria-hidden />} data-testid="transfer-send" aria-expanded={panel === 'send'} disabled={!can} onClick={() => setPanel(panel === 'send' ? null : 'send')}>
            {t('pharmacy.transfers.send')}
          </Button>
        )}
        {controls.receive === 'yes' && (
          <Button variant="primary" size="lg" className="min-h-11" icon={<PackageCheck aria-hidden />} data-testid="transfer-receive" aria-expanded={panel === 'receive'} disabled={!can} onClick={() => setPanel(panel === 'receive' ? null : 'receive')}>
            {t('pharmacy.transfers.receive')}
          </Button>
        )}
        {controls.edit && (
          <Link href={`/pharmacy/stock/transfers/${transfer.id}/edit`} data-testid="transfer-edit" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
            <PencilLine aria-hidden />
            {t('pharmacy.transfers.edit')}
          </Link>
        )}
        {controls.cancel && (
          <Button size="lg" className="min-h-11" icon={<Ban aria-hidden />} data-testid="transfer-cancel" aria-expanded={panel === 'cancel'} disabled={!can} onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
            {t('pharmacy.transfers.cancel')}
          </Button>
        )}
      </div>
      {controls.send === 'wrongPlace' && (
        <p data-testid="transfer-send-wrong-place" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">
            {t('pharmacy.transfers.send.wrongPlace', { branch: isolate(transfer.fromBranchName), here: isolate(props.placeBranchName ?? '') })}{' '}
            <Link href="/pharmacy/select" className="font-medium underline underline-offset-2">
              {t('pharmacy.shell.changeBranch')}
            </Link>
          </span>
        </p>
      )}

      {panel === 'cancel' && (
        <div role="region" aria-label={t('pharmacy.transfers.cancel.title')} className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4">
          <p className="max-w-[72ch] text-sm text-text">{t('pharmacy.transfers.cancel.body')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="lg" className="min-h-11" data-testid="transfer-cancel-yes" pending={pending} disabled={!can} onClick={() => void cancel()}>
              {t('pharmacy.transfers.cancel.yes')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={pending} onClick={() => setPanel(null)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </div>
      )}
      {panel === 'send' && controls.send === 'yes' && (
        <TransferSend
          userId={props.userId}
          restaurantId={props.restaurantId}
          transfer={transfer}
          canOverride={perms.override}
          today={props.today}
          rows={props.requestRows}
          online={online}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'receive' && controls.receive === 'yes' && (
        <TransferReceive
          userId={props.userId}
          restaurantId={props.restaurantId}
          transfer={transfer}
          canSeeLoss={perms.reportView}
          today={props.today}
          lines={props.sentRows}
          online={online}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}
