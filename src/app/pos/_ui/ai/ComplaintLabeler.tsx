'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { labelPosComplaints } from '@/app/studio/_actions/pos-ai';
import { formatNumber, ltr } from '@/lib/pos-format';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { OnlineOnlyNote, useOnline } from '../stock/controls';

/** The one button of the complaint labels: labels the next batch of complaints without a suggestion, then re-reads the page. */
export function ComplaintLabeler({ pending: waiting }: { pending: number }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function suggest() {
    setBusy(true);
    setMessage(null);
    const result = await settle(() => labelPosComplaints({}));
    setBusy(false);
    if (!result.ok) return setMessage({ tone: 'error', text: describeFailure(t, locale, result.error).message });
    if (!result.data.ok) return setMessage({ tone: 'error', text: t(`pos.ai.error.${result.data.code}`) });
    const { labeled, pending } = result.data;
    setMessage({ tone: 'ok', text: labeled === 0 ? t('pos.ai.complaints.nothing') : `${t('pos.ai.complaints.done', { count: ltr(formatNumber(labeled)) })}${pending > 0 ? ` ${t('pos.ai.complaints.moreWaiting')}` : ''}` });
    startRefresh(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" className="min-h-12" pending={busy || refreshing} disabled={!online || waiting === 0} icon={<Sparkles aria-hidden />} onClick={() => void suggest()}>
          {t('pos.ai.complaints.suggest')}
        </Button>
        <span className="text-sm text-muted">{waiting === 0 ? t('pos.ai.complaints.nothing') : t('pos.ai.complaints.pending', { count: ltr(formatNumber(waiting)) })}</span>
      </div>
      <OnlineOnlyNote />
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-danger' : 'text-muted'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
