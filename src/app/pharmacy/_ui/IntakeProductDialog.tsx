'use client';

import { PackageSearch } from 'lucide-react';
import { useRef, useState } from 'react';
import { receiptProduct } from '@/app/pharmacy/_actions/receipts';
import { formatNumber } from '@/lib/pos-format';
import type { SearchResult } from '@/server/pharmacy/search';
import { useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Dialog } from '@/studio/ui/Dialog';
import { Select } from '@/studio/ui/Select';
import { unitForPack, type PackUnit, type ReviewRow } from './intake-review-logic';
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
 * form's picker). Either way the pack comes next, as an explicit choice: the quantity on the invoice is counted in it, and a
 * box taken for a strip would be a tenfold error. The pack is preselected only when the invoice's own pack text names one.
 * No motion.
 */
export function IntakeProductDialog({ open, onOpenChange, row, onChoose }: IntakeProductDialogProps) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ productId: string; name: string; units: PackUnit[] } | null>(null);
  const [unitId, setUnitId] = useState('');

  /** Loads the packs of a product and moves to the pack step. Resolves to a sentence when it could not. */
  const pick = async (productId: string, name: string): Promise<string | null> => {
    setBusy(true);
    setProblem(null);
    const found = await settle(() => receiptProduct({ productId }));
    setBusy(false);
    if (!found.ok) return t('pharmacy.intake.rv.pick.unitFailed');
    const units = [...(found.data as { units: PackUnit[] }).units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty, level: u.level }));
    if (units.length === 0) return t('pharmacy.intake.rv.pick.noUnit');
    setUnitId(unitForPack(units, row.line.pack)?.id ?? '');
    setPending({ productId, name, units });
    return null;
  };

  const suggestion = async (c: ReviewRow['candidates'][number]) => {
    const error = await pick(c.productId, c.name);
    if (error) setProblem(error);
  };

  const confirm = async () => {
    if (!pending || unitId === '') return;
    setBusy(true);
    const error = await onChoose(pending.productId, unitId);
    setBusy(false);
    if (error) {
      setProblem(error);
      return;
    }
    setPending(null);
    onOpenChange(false);
  };

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) setPending(null);
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      width="md"
      title={t('pharmacy.intake.rv.pick.title')}
      description={<span dir="auto">{t('pharmacy.intake.rv.pick.for', { n: String(row.lineNo), name: isolate(row.line.name ?? '') })}</span>}
      footer={
        <Button size="lg" className="min-h-11" disabled={busy} onClick={() => close(false)} data-testid="pick-close">
          {t('pharmacy.intake.rv.pick.close')}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-testid="intake-pick">
        {pending ? (
          <section aria-labelledby="pick-unit" className="flex min-w-0 flex-col gap-3" data-testid="pick-unit-step">
            <h3 id="pick-unit" className="text-sm font-semibold text-text">
              {t('pharmacy.intake.rv.pick.unitTitle')}
            </h3>
            <p dir="auto" className="break-words text-base font-medium text-text">
              {pending.name}
            </p>
            <p className="text-sm text-muted">{t('pharmacy.intake.rv.pick.unitHint', { pack: isolate(row.line.pack ?? '-') })}</p>
            <Select
              size="lg"
              className="min-h-11"
              aria-label={t('pharmacy.intake.rv.unit.label')}
              data-testid="pick-unit"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              options={[{ value: '', label: t('pharmacy.intake.rv.unit.choose') }, ...pending.units.map((u) => ({ value: u.id, label: t('pharmacy.intake.rv.unit.option', { label: u.label, qty: formatNumber(u.baseQty) }) }))]}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" className="min-h-11" data-testid="pick-unit-confirm" disabled={busy || unitId === ''} onClick={() => void confirm()}>
                {t('pharmacy.intake.rv.pick.unitConfirm')}
              </Button>
              <Button size="lg" className="min-h-11" disabled={busy} onClick={() => setPending(null)}>
                {t('pharmacy.intake.rv.pick.back')}
              </Button>
            </div>
            {problem && <Message tone="error" testId="pick-problem">{problem}</Message>}
          </section>
        ) : (
          <>
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
            <ReceiptProductPicker boxRef={box} disabled={busy} onPick={(found: SearchResult) => pick(found.productId, found.label)} />
          </>
        )}
      </div>
    </Dialog>
  );
}
