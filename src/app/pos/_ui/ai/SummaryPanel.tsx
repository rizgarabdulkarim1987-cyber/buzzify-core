'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { phrasePosAiSummary } from '@/app/studio/_actions/pos-ai';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';

/**
 * The short text under a summary's figures: the one kept for these figures, or a button that has the AI write it (one
 * request, kept for next time). The text is only ever shown under the label that says AI wrote it from the figures above.
 */
export function SummaryPanel({ kind, locale: aiLocale, text: kept }: { kind: 'DAILY' | 'WEEKLY' | 'MONTHLY'; locale: 'ar' | 'ckb' | 'en'; text: string | null }) {
  const t = useT();
  const { locale } = useLocale();
  const [text, setText] = useState(kept);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write() {
    setBusy(true);
    setError(null);
    const result = await settle(() => phrasePosAiSummary({ kind, locale: aiLocale }));
    setBusy(false);
    if (!result.ok) return setError(describeFailure(t, locale, result.error).message);
    if (!result.data.ok) return setError(t(`pos.ai.error.${result.data.code}`));
    setText(result.data.text);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {text !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line px-4 py-3">
          <p className="whitespace-pre-wrap text-base text-text [overflow-wrap:anywhere]" dir="auto" data-testid="ai-summary-text">
            {text}
          </p>
          <p className="text-sm text-muted">{t('pos.ai.summary.written')}</p>
        </div>
      ) : (
        <Button variant="primary" size="lg" className="min-h-12 self-start" pending={busy} icon={<Sparkles aria-hidden />} onClick={() => void write()}>
          {t('pos.ai.summary.write')}
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="text-sm text-muted">{t('pos.ai.checkNote')}</p>
    </div>
  );
}
