'use client';

import type { Palette } from '@/lib/brand';
import { BRAND_PRESET_IDS, BRAND_PRESETS } from '@/lib/palette';
import { useT } from '@/studio/i18n';

/** A palette's colours as a strip of swatches, background first. */
export function Swatches({ palette }: { palette: Palette }) {
  return (
    <span aria-hidden className="flex h-6 overflow-hidden rounded-sm border border-line">
      {(['bg', 'surface', 'accent', 'text', 'muted'] as const).map((key) => (
        <span key={key} className="w-4" style={{ background: palette[key] }} />
      ))}
    </span>
  );
}

/** The five curated palettes for the theme being edited (spec 12); choosing one replaces the palette. */
export function PresetPicker({ theme, onPick }: { theme: 'light' | 'dark'; onPick: (palette: Palette) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {BRAND_PRESET_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick({ ...BRAND_PRESETS[id][theme] })}
          className="flex items-center gap-2 rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-sm text-text transition-colors hover:bg-hover"
        >
          <Swatches palette={BRAND_PRESETS[id][theme]} />
          {t(`brand.preset.${id}`)}
        </button>
      ))}
    </div>
  );
}
