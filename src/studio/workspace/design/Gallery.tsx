'use client';

import { Box, Check, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FONT_PAIR_VARIABLES } from '@/lib/font-pairs';
import { BUSINESS_TYPES, STYLE_TAGS, templateList, type BusinessType, type StyleTag, type TemplateId, type TemplatePreset } from '@/lib/templates';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { face } from '@/studio/workspace/brand/FontPairPicker';

export type GallerySelection = TemplateId | 'classic';

/** Which business type a restaurant's type suggests for the first filter. */
export function businessOf(restaurantType: string): BusinessType | 'all' {
  if (restaurantType === 'CAFE') return 'cafe';
  if (restaurantType === 'BAKERY') return 'bakery';
  if (restaurantType === 'ICE_CREAM') return 'icecream';
  if (restaurantType === 'RESTAURANT' || restaurantType === 'FINE_DINING' || restaurantType === 'FAST_FOOD') return 'restaurant';
  return 'all';
}

/**
 * A preset's card: its real thumbnail (a screenshot of the renderer with demo content, `public/templates/{id}.webp`)
 * over a sample drawn from its palette and type, which shows while the picture loads or when it is missing.
 */
function TemplateCard({ preset, selected, current, onSelect }: { preset: TemplatePreset; selected: boolean; current: boolean; onSelect: () => void }) {
  const t = useT();
  const [thumb, setThumb] = useState(true);
  const { palette } = preset;
  const fonts = FONT_PAIR_VARIABLES[preset.type.fontPairId];
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('design.select', { name: preset.name })}
        onClick={onSelect}
        className={cx(
          'group flex w-full flex-col overflow-hidden rounded-lg border text-start transition-[border-color,box-shadow]',
          selected ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-line-strong',
        )}
      >
        <span className="relative block aspect-[3/4] w-full overflow-hidden" style={{ background: palette.bg, color: palette.text }}>
          <span className="absolute inset-0 flex flex-col justify-end gap-2 p-3">
            <span className="block text-[1.35rem] leading-tight" style={{ fontFamily: face(fonts.display), textTransform: preset.type.displayCase === 'upper' ? 'uppercase' : 'none' }}>
              {preset.name}
            </span>
            <span className="flex gap-1">
              {[palette.accent, palette.surface, palette.button, palette.raised].map((colour, index) => (
                <span key={index} className="size-4 rounded-full" style={{ background: colour, boxShadow: `inset 0 0 0 1px ${palette.line}` }} />
              ))}
            </span>
          </span>
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element -- a fixed screenshot of the preset; a missing file falls back to the sample beneath
            <img src={`/templates/${preset.id}.webp`} alt="" loading="lazy" decoding="async" onError={() => setThumb(false)} className="absolute inset-0 size-full object-cover object-top" />
          )}
          {current && (
            <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-on-ink">
              <Check aria-hidden className="size-3" />
              {t('design.current')}
            </span>
          )}
        </span>
        <span className="flex flex-col gap-1.5 border-t border-line bg-surface p-3">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-text">
              <span className="me-1.5 tabular-nums text-muted">{String(preset.number).padStart(2, '0')}</span>
              {preset.name}
            </span>
            <span className="shrink-0 text-xs text-muted">{t(`design.business.${preset.business}`)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-px" title={t('design.badge.motionHint')}>
              <Sparkles aria-hidden className="size-3" />
              {t('design.badge.motion')}
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-px" title={t('design.badge.3dHint')}>
              <Box aria-hidden className="size-3" />
              {t('design.badge.3d')}
            </span>
            {preset.tags.map((tag) => (
              <span key={tag}>{t(`design.style.${tag}`)}</span>
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

function ClassicCard({ selected, current, onSelect }: { selected: boolean; current: boolean; onSelect: () => void }) {
  const t = useT();
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('design.select', { name: t('design.classic') })}
        onClick={onSelect}
        className={cx('flex h-full w-full flex-col overflow-hidden rounded-lg border text-start', selected ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-line-strong')}
      >
        <span className="relative flex aspect-[3/4] w-full flex-col justify-end gap-2 bg-[#0e0e0f] p-3 text-[#ede8df]">
          <span className="block text-[1.35rem] leading-tight" style={{ fontFamily: face('--font-bodoni') }}>
            {t('design.classic')}
          </span>
          <span className="text-xs text-[#a7a096]">{t('design.classic.description')}</span>
          {current && (
            <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#ede8df] px-2 py-0.5 text-xs font-medium text-[#0e0e0f]">
              <Check aria-hidden className="size-3" />
              {t('design.current')}
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col gap-1 border-t border-line bg-surface p-3">
          <span className="text-sm font-semibold text-text">{t('design.classic')}</span>
          <span className="text-xs text-muted">{t('design.classic.brandTab')}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * The template gallery: Classic and the thirty presets, filtered by business type (starting with the restaurant's own)
 * and by style. Choosing a card previews it on the menu's own products; nothing changes until it is applied.
 */
export function Gallery({
  restaurantType,
  current,
  selected,
  onSelect,
}: {
  restaurantType: string;
  current: GallerySelection;
  selected: GallerySelection;
  onSelect: (selection: GallerySelection) => void;
}) {
  const t = useT();
  const [business, setBusiness] = useState<BusinessType | 'all'>(() => businessOf(restaurantType));
  const [styles, setStyles] = useState<ReadonlySet<StyleTag>>(new Set());
  const presets = useMemo(
    () => templateList().filter((preset) => (business === 'all' || preset.business === business) && [...styles].every((style) => preset.tags.includes(style))),
    [business, styles],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div role="group" aria-label={t('design.filter.business')} className="flex flex-wrap gap-1.5">
          {(['all', ...BUSINESS_TYPES] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={business === value}
              onClick={() => setBusiness(value)}
              className={cx('h-7 rounded-full border px-3 text-sm transition-colors', business === value ? 'border-ink bg-ink text-on-ink' : 'border-line text-muted hover:text-text')}
            >
              {value === 'all' ? t('design.filter.all') : t(`design.business.${value}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t('design.filter.style')} className="flex flex-wrap gap-1.5">
          {STYLE_TAGS.map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={styles.has(style)}
              onClick={() =>
                setStyles((currentStyles) => {
                  const next = new Set(currentStyles);
                  if (next.has(style)) next.delete(style);
                  else next.add(style);
                  return next;
                })
              }
              className={cx('h-7 rounded-full border px-3 text-sm transition-colors', styles.has(style) ? 'border-ink bg-hover text-text' : 'border-line text-muted hover:text-text')}
            >
              {t(`design.style.${style}`)}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {t('design.filter.count', { count: presets.length })}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
        {business === 'all' && styles.size === 0 && <ClassicCard selected={selected === 'classic'} current={current === 'classic'} onSelect={() => onSelect('classic')} />}
        {presets.map((preset) => (
          <TemplateCard key={preset.id} preset={preset} selected={selected === preset.id} current={current === preset.id} onSelect={() => onSelect(preset.id)} />
        ))}
      </ul>
    </div>
  );
}
