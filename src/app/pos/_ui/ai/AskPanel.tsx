'use client';

import { Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { askPosAi } from '@/app/studio/_actions/pos-ai';
import { formatNumber, ltr } from '@/lib/pos-format';
import type { AskAnswer } from '@/server/ai/ask';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Textarea } from '@/studio/ui/Textarea';

interface Turn {
  q: string;
  a: string;
  sources: AskAnswer['sources'];
}

const EXAMPLES = ['pos.ai.ask.example1', 'pos.ai.ask.example2', 'pos.ai.ask.example3'] as const;

/**
 * One conversation: each answer carries its sources (the report or list it came from, the period), built by the server, and
 * the person sees how many of this month's requests are left. A refusal is one calm sentence under the box, never a dialog.
 */
export function AskPanel({ used: startUsed, limit: startLimit, locale: aiLocale }: { used: number; limit: number; locale: 'ar' | 'ckb' | 'en' }) {
  const t = useT();
  const { locale } = useLocale();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState({ used: startUsed, limit: startLimit });
  const end = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed === '' || pending) return;
    setPending(true);
    setError(null);
    const result = await settle(() => askPosAi({ locale: aiLocale, question: trimmed, history: turns.slice(-6).map((turn) => ({ q: turn.q, a: turn.a.slice(0, 4000) })) }));
    setPending(false);
    if (!result.ok) {
      setError(describeFailure(t, locale, result.error).message);
      return;
    }
    if (!result.data.ok) {
      setError(t(`pos.ai.error.${result.data.code}`));
      return;
    }
    const { answer } = result.data;
    setTurns((prev) => [...prev, { q: trimmed, a: answer.text, sources: answer.sources }]);
    setUsage({ used: answer.used, limit: answer.limit });
    setQuestion('');
    requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'nearest' }));
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <p className="text-sm text-muted" data-testid="ai-usage">
        {t('pos.ai.usage', { used: ltr(formatNumber(usage.used)), limit: ltr(formatNumber(usage.limit)) })}
      </p>

      {turns.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-text">{t('pos.ai.ask.examples')}</p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((key) => (
              <li key={key}>
                <button type="button" className="min-h-12 rounded-md border border-line px-4 text-start text-base text-text hover:bg-hover" onClick={() => setQuestion(t(key))}>
                  {t(key)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="flex flex-col gap-5" aria-live="polite">
          {turns.map((turn, index) => (
            <li key={index} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted">{t('pos.ai.ask.you')}</span>
                <p className="text-base text-text [overflow-wrap:anywhere]" dir="auto">
                  {turn.q}
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-lg border border-line px-4 py-3">
                <span className="text-sm font-medium text-muted">{t('pos.ai.ask.answer')}</span>
                <p className="whitespace-pre-wrap text-base text-text [overflow-wrap:anywhere]" dir="auto">
                  {turn.a}
                </p>
                {turn.sources.length > 0 ? (
                  <div className="flex flex-col gap-1 border-t border-line pt-2">
                    <span className="text-sm font-medium text-muted">{t('pos.ai.sources')}</span>
                    <ul className="flex flex-col gap-0.5 text-sm text-muted">
                      {turn.sources.map((source, i) => (
                        <li key={i}>
                          {t(`pos.ai.method.${source.tool}`)}
                          {source.period ? ` · ${t('pos.ai.source.period', { from: ltr(source.period.from), to: ltr(source.period.to) })}` : ''}
                          {source.empty ? ` · ${t('pos.ai.source.empty')}` : ''}
                          {source.truncated ? ` · ${t('pos.ai.source.truncated')}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
          <div ref={end} />
        </ol>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(question);
        }}
      >
        <label htmlFor="ai-question" className="text-sm font-medium text-text">
          {t('pos.ai.ask.label')}
        </label>
        <Textarea
          id="ai-question"
          dir="auto"
          rows={3}
          maxLength={1000}
          value={question}
          placeholder={t('pos.ai.ask.placeholder')}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send(question);
            }
          }}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="lg" className="min-h-12" pending={pending} disabled={question.trim() === ''} icon={<Send aria-hidden className="rtl:-scale-x-100" />}>
            {pending ? t('pos.ai.ask.thinking') : t('pos.ai.ask.send')}
          </Button>
          {turns.length > 0 ? (
            <Button size="lg" className="min-h-12" disabled={pending} onClick={() => setTurns([])}>
              {t('pos.ai.ask.clear')}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted">{t('pos.ai.checkNote')}</p>
      </form>
    </div>
  );
}
