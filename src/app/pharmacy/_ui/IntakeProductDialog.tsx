'use client';

import { PackageSearch } from 'lucide-react';
import { useRef, useState } from 'react';
import { searchProducts } from '@/app/pharmacy/_actions/catalog';
import type { SearchResult } from '@/server/pharmacy/search';
import { useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Dialog } from '@/studio/ui/Dialog';
import { Button } from '@/studio/ui/Button';
import type { ReviewRow } from './intake-review-logic';
import { Message } from './intake-review-parts';
import { ReceiptProductPicker } from './ReceiptProductPicker';
import { isolate } from './WriteBlocked';

export interface IntakeProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: Pick<ReviewRow, 'lineNo' | 'line' | 'candidates'>;
  /** Chooses the product and its pack for the line. Resolves to a sentence when it could not be done. */
  onChoose: (productId: string, unitId: string) => Promise<string | null>;
}

/**
 * "Choose product" for one line: the products the matcher suggested (names only) and the catalog's own search (the receiving
 * form's picker). A suggestion is opened through the same search to find its pack; a result without a pack cannot be received
 * in, and says so. No motion.
 */
export function IntakeProductDialog({ open, onOpenChange, row, onChoose }: IntakeProductDialogProps) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (found: Pick<SearchResult, 'productId' | 'unitId'>): Promise<string | null> => {
    if (!found.unitId) return t('pharmacy.intake.rv.pick.noUnit');
    const error = await onChoose(found.productId, found.unitId);
    if (!error) onOpenChange(false);
    return error;
  };

  const suggestion = async (c: ReviewRow['candidates'][number]) => {
    setBusy(true);
    setProblem(null);
    const found = await settle(() => searchProducts({ q: c.name }));
    const hit = found.ok ? (found.data as SearchResult[]).find((r) => r.productId === c.productId) : undefined;
    if (!hit) {
      setProblem(t('pharmacy.intake.rv.pick.suggestFailed'));
      setBusy(false);
      return;
    }
    const error = await choose(hit);
    if (error) setProblem(error);
    setBusy(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      width="md"
      title={t('pharmacy.intake.rv.pick.title')}
      description={<span dir="auto">{t('pharmacy.intake.rv.pick.for', { n: String(row.lineNo), name: isolate(row.line.name ?? '') })}</span>}
      footer={
        <Button size="lg" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)} data-testid="pick-close">
          {t('pharmacy.intake.rv.pick.close')}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-testid="intake-pick">
        <section aria-labelledby="pick-suggest" className="flex min-w-0 flex-col gap-2">
          <h3 id="pick-suggest" className="text-sm font-semibold text-text">
            {t('pharmacy.intake.rv.pick.suggest')}
          </h3>
          {row.candidates.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.intake.rv.pick.noSuggest')}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {row.candidates.map((c) => (
                <li key={c.productId} className="border-b border-line">
                  <button
                    type="button"
                    data-testid="pick-candidate"
                    disabled={busy}
                    onClick={() => void suggestion(c)}
                    className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-sm px-2 py-2 text-start hover:bg-hover disabled:opacity-60"
                  >
                    <PackageSearch aria-hidden className="size-4 shrink-0 text-muted" />
                    <span dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                      {c.name}
                    </span>
                    <span dir="auto" className="min-w-0 break-words text-sm text-muted">
                      {[c.strength, c.form].filter((p) => p.trim() !== '').join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {problem && <Message tone="error" testId="pick-problem">{problem}</Message>}
        <ReceiptProductPicker boxRef={box} disabled={busy} onPick={choose} />
      </div>
    </Dialog>
  );
}
