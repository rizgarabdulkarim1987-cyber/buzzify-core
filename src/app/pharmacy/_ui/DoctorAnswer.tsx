'use client';

import { Check, Info, OctagonAlert, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { MatchedItem, MatchedOption } from '@/server/pharmacy/doctor/matcher';
import type { DoctorResponse } from '@/server/pharmacy/doctor/service';
import { useT } from '@/studio/i18n';
import { addToCart } from './cart-bridge';
import { answerSections, cartItemOf, sellAddHref, type DoctorLine, type DoctorSection, type SectionTone } from './doctor-logic';
import { Money } from './money-parts';

/** Where an in-stock option goes: straight into the open Sell cart (`bridge`), or a link that opens Sell with it (`link`, Home and the full page). */
export type AddMode = 'bridge' | 'link';

const BOX: Record<SectionTone, string> = {
  danger: 'rounded-ph-xl bg-ph-red-wash px-3.5 py-3 text-ph-red',
  warn: 'rounded-ph-xl bg-ph-amber-wash px-3.5 py-3 text-ph-amber-ink',
  note: 'rounded-ph-xl bg-ph-canvas px-3.5 py-3 text-ph-text',
  plain: 'text-ph-text',
  fine: '',
};
const HEAD = 'flex items-center gap-1.5 text-sm font-bold';
const ADD = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-ph-xl bg-ph-g6 px-3.5 text-sm font-bold text-ph-on-green hover:bg-ph-g8';

/** A model line is a text node in its own direction; a fixed line is the app's translated message. Never markup. */
function Line({ line }: { line: DoctorLine }) {
  const t = useT();
  return line.kind === 'model' ? <bdi dir="auto">{line.text}</bdi> : <>{t(line.key)}</>;
}

function Lines({ lines, tone }: { lines: DoctorLine[]; tone: SectionTone }) {
  if (lines.length === 1) return <p className={`break-words ${tone === 'plain' ? 'text-base' : 'text-sm text-ph-text'}`}><Line line={lines[0]!} /></p>;
  return (
    <ul className={`flex list-disc flex-col gap-1 ps-5 marker:text-current ${tone === 'plain' ? 'text-base' : 'text-sm text-ph-text'}`}>
      {lines.map((line, i) => (
        <li key={i} className="break-words">
          <Line line={line} />
        </li>
      ))}
    </ul>
  );
}

function AddButton({ item, mode }: { item: MatchedItem; mode: AddMode }) {
  const t = useT();
  const [added, setAdded] = useState(false);
  if (mode === 'link') {
    return (
      <Link href={sellAddHref(item)} data-testid="doctor-add" className={ADD}>
        <Plus aria-hidden className="size-4" />
        {t('pharmacy.doctor.option.add')}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-testid="doctor-add"
      className={ADD}
      onClick={() => {
        addToCart(cartItemOf(item));
        setAdded(true);
      }}
    >
      {added ? <Check aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
      {t(added ? 'pharmacy.doctor.option.added' : 'pharmacy.doctor.option.add')}
    </button>
  );
}

/**
 * One option. In stock: the ingredient, the model's note as plain muted text under it (never beside a number), then up to three
 * of the shop's products, each with ITS catalog price per unit, the sellable quantity and Add to cart. Not in stock: the
 * ingredient and "not in your stock", nothing else (no note, no number, no button), so it can never read as available.
 */
function OptionRow({ option, mode }: { option: MatchedOption; mode: AddMode }) {
  const t = useT();
  if (option.status === 'NOT_IN_STOCK') {
    return (
      <li data-testid="doctor-option-NOT_IN_STOCK" className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 py-2">
        <bdi dir="auto" className="min-w-0 break-words font-semibold">
          {option.ingredient}
        </bdi>
        <span className="rounded-full bg-ph-canvas px-2.5 py-1 text-xs font-bold text-ph-muted">{t('pharmacy.doctor.option.notInStock')}</span>
      </li>
    );
  }
  return (
    <li data-testid="doctor-option-IN_STOCK" className="flex flex-col gap-1.5 py-2">
      <bdi dir="auto" className="break-words font-semibold">
        {option.ingredient}
      </bdi>
      {option.note ? (
        <p data-testid="doctor-option-note" className="break-words text-sm text-ph-muted" dir="auto">
          {option.note}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {option.items.map((item) => (
          <li key={item.unitId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-ph-xl bg-ph-g1 px-3 py-2">
            <span className="flex min-w-0 flex-1 basis-40 flex-col">
              <bdi dir="auto" className="break-words font-semibold text-ph-g9">
                {[item.tradeName, item.strength].filter(Boolean).join(' ')}
              </bdi>
              <span className="flex flex-wrap gap-x-2 text-xs text-ph-muted">
                <span data-testid="doctor-item-price" className="font-semibold text-ph-text">
                  <Money minor={item.priceMinor} currency={item.currency} /> / <bdi dir="auto">{item.unitLabel}</bdi>
                </span>
                <span data-testid="doctor-item-qty">{t('pharmacy.doctor.option.left', { qty: item.sellableQty, unit: item.unitLabel })}</span>
              </span>
            </span>
            <AddButton item={item} mode={mode} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function Section({ section, result, mode }: { section: DoctorSection; result: DoctorResponse; mode: AddMode }) {
  const t = useT();
  const testId = `doctor-section-${section.id}`;
  if (section.id === 'disclaimer') {
    return (
      <p data-testid="doctor-disclaimer" className="flex items-start gap-1.5 border-t border-ph-line pt-2.5 text-xs font-medium text-ph-muted [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0">
        <Info aria-hidden />
        {t(section.lines[0]!.kind === 'msg' ? section.lines[0]!.key : '')}
      </p>
    );
  }
  if (section.id === 'options') {
    const options = result.kind === 'ANSWER' ? result.options : [];
    return (
      <section data-testid={testId} aria-labelledby={`${testId}-h`} className="flex flex-col">
        <h3 id={`${testId}-h`} className={`${HEAD} text-ph-muted`}>
          {t('pharmacy.doctor.section.options')}
        </h3>
        <ul className="flex flex-col divide-y divide-ph-line">
          {options.map((o) => (
            <OptionRow key={o.ingredient} option={o} mode={mode} />
          ))}
        </ul>
      </section>
    );
  }
  const titled = section.id !== 'unsure' && section.id !== 'unavailable';
  const icon: ReactNode = section.tone === 'danger' ? <OctagonAlert aria-hidden className="size-4 shrink-0" /> : section.tone === 'warn' ? <TriangleAlert aria-hidden className="size-4 shrink-0" /> : null;
  return (
    <section data-testid={testId} aria-labelledby={titled ? `${testId}-h` : undefined} className={`flex flex-col gap-1 ${BOX[section.tone]}`}>
      {titled ? (
        <h3 id={`${testId}-h`} className={`${HEAD} ${section.tone === 'plain' ? 'text-ph-muted' : ''}`}>
          {icon}
          {t(`pharmacy.doctor.section.${section.id}`)}
        </h3>
      ) : null}
      <Lines lines={section.lines} tone={section.tone} />
    </section>
  );
}

/**
 * A Doctor result drawn in the order `answerSections` decides: red flags first and red, the app's "consult a doctor" line last,
 * always. Model text is only ever a text node; prices and quantities only ever come from the matched catalog fields.
 */
export function DoctorAnswer({ result, addMode }: { result: DoctorResponse; addMode: AddMode }) {
  return (
    <div data-testid="doctor-answer" className="flex min-w-0 flex-col gap-3">
      {answerSections(result).map((s) => (
        <Section key={s.id} section={s} result={result} mode={addMode} />
      ))}
    </div>
  );
}
