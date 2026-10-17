'use client';

import { HEX, type Palette } from '@/lib/brand';
import { contrastRatio } from '@/lib/palette';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { CONTRAST_CHECKS, ContrastBadge, contrastState } from './ContrastBadge';

/** The palette's colours, in the order they are thought about: the grounds, the accent, the text, the rest. */
export const COLOUR_KEYS: ReadonlyArray<keyof Palette> = ['bg', 'surface', 'raised', 'accent', 'onAccent', 'text', 'muted', 'line'];

export interface PairResult {
  foreground: keyof Palette;
  background: keyof Palette;
  ratio: number | null;
  state: 'pass' | 'warn' | 'fail' | null;
  needs: number;
}

/** Every checked pair of a palette with its ratio; a pair with a colour that is not a full hex yet has no ratio. */
export function checkPalette(palette: Palette): PairResult[] {
  return CONTRAST_CHECKS.map((check) => {
    const fg = palette[check.foreground];
    const bg = palette[check.background];
    if (!HEX.test(fg) || !HEX.test(bg)) return { ...check, ratio: null, state: null };
    const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
    return { ...check, ratio, state: contrastState(ratio, check) };
  });
}

/**
 * The eight colours of the palette, each a colour picker and its hex value, and the contrast of every checked pair as it
 * stands: text must reach 4.5:1 on the grounds (the kit cannot be saved otherwise), the accent should reach 3:1.
 */
export function PaletteEditor({ palette, onChange }: { palette: Palette; onChange: (palette: Palette) => void }) {
  const t = useT();
  const results = checkPalette(palette);
  const set = (key: keyof Palette, value: string) => onChange({ ...palette, [key]: value });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {COLOUR_KEYS.map((key) => {
          const label = t(`brand.colour.${key}`);
          const valid = HEX.test(palette[key]);
          return (
            <Field key={key} label={label} error={valid ? undefined : t('brand.colour.invalid')}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={valid ? palette[key].toLowerCase() : '#000000'}
                  onChange={(event) => set(key, event.target.value.toUpperCase())}
                  aria-label={t('brand.colour.pick', { colour: label })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-line-strong bg-raised p-0.5"
                />
                <Input
                  value={palette[key]}
                  dir="ltr"
                  maxLength={7}
                  spellCheck={false}
                  onChange={(event) => set(key, event.target.value.trim())}
                  className="font-mono uppercase"
                />
              </div>
            </Field>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-text">{t('brand.contrast.title')}</h4>
        <ul aria-label={t('brand.contrast.title')} className="flex flex-col divide-y divide-line rounded-md border border-line">
          {results.map((result) => (
            <li key={`${result.foreground}/${result.background}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-text">
                <span
                  aria-hidden
                  className="inline-flex size-6 items-center justify-center rounded-sm border border-line text-xs font-semibold"
                  style={HEX.test(palette[result.background]) && HEX.test(palette[result.foreground]) ? { background: palette[result.background], color: palette[result.foreground] } : undefined}
                >
                  Aa
                </span>
                {t(`brand.pair.${result.foreground}/${result.background}`)}
                <span className="text-muted">· {t('brand.contrast.needs', { ratio: result.needs.toFixed(1) })}</span>
              </span>
              <ContrastBadge ratio={result.ratio} state={result.state} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
