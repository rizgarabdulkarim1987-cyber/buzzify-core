'use client';

import { Plus, ScanBarcode } from 'lucide-react';
import { useRef, useState } from 'react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { formatNumber } from '@/lib/pos-format';

export interface ScanOutcome {
  tone: 'ok' | 'error' | 'info';
  text: string;
  /** No line fits the scanned product: the screen offers to add one for it. */
  noLine?: { productName: string; code: string };
}

export interface IntakeScanProps {
  /** Sends one scan to the server and says what happened, in words. Scans are sent one after the other, in the order they came. */
  onScan: (code: string) => Promise<ScanOutcome>;
  onAddLine: (productName: string, code: string) => void;
  /** Why scanning is not possible at all (read-only, no role, closed), or null. */
  blocked: string | null;
}

/**
 * One scan field for the whole batch. It keeps focus and is never disabled while a write runs: a hand scanner types the next
 * code at once, so scans are queued and sent in order, none dropped. The answer is written in words in a live region (which
 * line, which product, what was filled). No motion.
 */
export function IntakeScan({ onScan, onAddLine, blocked }: IntakeScanProps) {
  const t = useT();
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(0);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const queue = useRef<string[]>([]);
  const running = useRef(false);

  const drain = async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length > 0) {
      const code = queue.current.shift()!;
      setWaiting(queue.current.length);
      setOutcome({ tone: 'info', text: t('pharmacy.intake.rv.scanAll.working') });
      setOutcome(await onScan(code));
    }
    running.current = false;
    setWaiting(0);
  };

  return (
    <div className="flex min-w-0 max-w-xl flex-col gap-2" data-testid="intake-scan">
      <Field label={t('pharmacy.intake.rv.scanAll.label')} hint={t('pharmacy.intake.rv.scanAll.hint')}>
        <div className="relative">
          <ScanBarcode aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            size="lg"
            className="min-h-11 ps-8"
            dir="ltr"
            autoComplete="off"
            enterKeyHint="done"
            data-testid="scan-all"
            disabled={blocked !== null}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const code = text.trim();
              if (code === '') return;
              setText('');
              queue.current.push(code);
              setWaiting(queue.current.length);
              void drain();
            }}
          />
        </div>
      </Field>
      {blocked && <p className="text-sm text-muted">{blocked}</p>}
      <div role="status" aria-live="polite" data-testid="scan-result" className="flex min-w-0 flex-col gap-1 text-sm text-text">
        {waiting > 0 && <span>{t('pharmacy.intake.rv.scanAll.waiting', { count: formatNumber(waiting) })}</span>}
        {outcome && (
          <span data-tone={outcome.tone} className={outcome.tone === 'error' ? 'text-danger' : undefined}>
            {outcome.text}
          </span>
        )}
      </div>
      {outcome?.noLine && (
        <Button size="lg" className="min-h-11 w-fit" icon={<Plus aria-hidden />} data-testid="scan-add-line" onClick={() => onAddLine(outcome.noLine!.productName, outcome.noLine!.code)}>
          {t('pharmacy.intake.rv.scanAll.addLine')}
        </Button>
      )}
    </div>
  );
}
