'use client';

import { FONT_PAIR_IDS, FONT_PAIR_VARIABLES, FONT_PAIRS, type FontPairId } from '@/lib/font-pairs';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

/** A face by its CSS variable, with a generic fallback while it loads. */
export const face = (variable: string, generic: 'serif' | 'sans-serif' = 'serif') => `var(${variable}), ${generic}`;

/**
 * The six font pairs, each a choice drawn in its own faces: a Latin heading and line, and the same in Arabic script.
 * The page attaches every pair's faces (`allPairFontVariables`), so each sample shows as guests would see it.
 */
export function FontPairPicker({ value, onChange }: { value: FontPairId; onChange: (pair: FontPairId) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('brand.fonts')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {FONT_PAIR_IDS.map((id) => {
        const variables = FONT_PAIR_VARIABLES[id];
        const checked = value === id;
        return (
          <label
            key={id}
            className={cx(
              'flex cursor-pointer flex-col gap-2 rounded-md border p-3 transition-colors',
              checked ? 'border-ink ring-1 ring-ink' : 'border-line-strong hover:bg-hover',
            )}
          >
            <span className="flex items-center gap-2">
              <input type="radio" name="font-pair" checked={checked} onChange={() => onChange(id)} className="size-3.5 accent-ink" />
              <span className="text-sm font-medium text-text">{t(`brand.pair.name.${id}`)}</span>
              <span className="text-xs text-muted">
                {FONT_PAIRS[id].display} · {FONT_PAIRS[id].text}
              </span>
            </span>
            <span aria-hidden className="flex flex-col gap-0.5 text-text">
              <span className="text-xl leading-tight" style={{ fontFamily: face(variables.display) }}>
                Coffee &amp; cake
              </span>
              <span className="text-sm" style={{ fontFamily: face(variables.text, 'sans-serif') }}>
                Espresso, oat milk — 4.50
              </span>
              <span lang="ar" dir="rtl" className="text-base" style={{ fontFamily: face(variables.arabic, 'sans-serif') }}>
                قهوة وكعك · قاوە و کێک
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
