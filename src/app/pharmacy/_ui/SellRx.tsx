'use client';

import { CircleAlert, CircleCheck, FilePlus2, Pill, ShieldAlert, X } from 'lucide-react';
import { controlledLimits, rxLevelOfLines, type RxLine } from '@/app/pharmacy/_ui/prescription-logic';
import { useT } from '@/studio/i18n';
import { Chip, Note, Num, TOUCH_BTN } from './sell-parts';

/**
 * The cart's prescription row: shown when a line is a prescription (RX) or controlled (RESTRICTED) medicine. It says whether a
 * prescription is attached, what each controlled product's quantity is against the limit, and opens the drawer. Nothing here
 * holds a patient field: the number shown is the one typed in this session; after a reload only the saved state is known.
 */
export function RxCartPanel({
  lines,
  maxQty,
  attached,
  number,
  mayDispense,
  onOpen,
  onDetach,
}: {
  lines: RxLine[];
  maxQty: number;
  attached: boolean;
  number: string | null;
  mayDispense: boolean;
  onOpen: () => void;
  onDetach: () => void;
}) {
  const t = useT();
  const level = rxLevelOfLines(lines);
  if (!level) return null;
  const limits = controlledLimits(lines, maxQty);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3" data-testid="rx-panel">
      <p className="flex items-center gap-2 text-sm font-semibold text-text">
        <Pill aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.rx.panel.title')}
      </p>
      {limits.map((l) => (
        <p key={l.productId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text" data-testid="rx-limit" data-over={l.over ? 'true' : undefined}>
          {l.over ? <CircleAlert aria-hidden className="size-4 shrink-0 text-danger" /> : <ShieldAlert aria-hidden className="size-4 shrink-0 text-muted" />}
          <span className="min-w-0 break-words" dir="auto">
            {l.name}
          </span>
          <span className={l.over ? 'font-medium text-danger' : 'text-muted'}>
            {l.max > 0 ? t('pharmacy.rx.limit', { qty: l.baseQty, max: l.max }) : t('pharmacy.rx.limit.none', { qty: l.baseQty })}
          </span>
        </p>
      ))}
      {!mayDispense ? (
        <Note icon={<ShieldAlert aria-hidden />} role="status" testId="rx-needs-pharmacist">
          {t('pharmacy.sell.blocked.rx')}
        </Note>
      ) : attached ? (
        <div className="flex flex-wrap items-center gap-2">
          <Chip icon={<CircleCheck aria-hidden />} testId="rx-attached">
            {t('pharmacy.rx.attached')}
            {number ? (
              <>
                {' '}
                <Num>{number}</Num>
              </>
            ) : null}
          </Chip>
          <button type="button" className={TOUCH_BTN} data-testid="rx-detach" onClick={onDetach}>
            <X aria-hidden className="size-4" />
            {t('pharmacy.rx.detach')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Chip icon={<CircleAlert aria-hidden />} tone={level === 'RESTRICTED' ? 'danger' : 'plain'} testId="rx-missing">
            {t(level === 'RESTRICTED' ? 'pharmacy.rx.missing.required' : 'pharmacy.rx.missing.optional')}
          </Chip>
          <button type="button" className={TOUCH_BTN} data-testid="rx-open" onClick={onOpen}>
            <FilePlus2 aria-hidden className="size-4" />
            {t('pharmacy.rx.add')}
          </button>
        </div>
      )}
    </div>
  );
}
