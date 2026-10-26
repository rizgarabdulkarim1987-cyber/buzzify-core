import { derivePalette, themeOf, type PaletteSeed } from './palette';
import type { BusinessType, DesignLayout, DesignType, SceneSettings, StyleTag, TemplateId, TemplatePreset } from './types';

const DEFAULT_TYPE: Omit<DesignType, 'fontPairId'> = { scale: 1, displayCase: 'normal', tracking: 0 };

/** What every scene starts from; a preset changes what its identity needs. */
export function defaultScene(theme: 'dark' | 'light'): SceneSettings {
  return {
    mode: '3d',
    intensity: 0.6,
    speed: 1,
    ambient: true,
    tap: true,
    scroll: true,
    brightness: 1,
    blur: 0,
    opacity: 1,
    overlay: theme === 'dark' ? 0.12 : 0.18,
  };
}

interface PresetInput {
  id: TemplateId;
  number: number;
  name: string;
  business: BusinessType;
  tags: StyleTag[];
  seed: PaletteSeed;
  /** The curated alternatives, besides the preset's own palette (listed first as "Signature"). */
  alternatives: Array<{ id: string; name: string; seed: PaletteSeed }>;
  type: Partial<DesignType> & Pick<DesignType, 'fontPairId'>;
  layout: DesignLayout;
  scene?: Partial<SceneSettings>;
  version?: number;
}

/** A preset from its description: palettes derived from their seeds, type and scene filled from the defaults. */
export function definePreset(input: PresetInput): TemplatePreset {
  const palette = derivePalette(input.seed);
  return {
    id: input.id,
    number: input.number,
    name: input.name,
    business: input.business,
    tags: input.tags,
    version: input.version ?? 1,
    palette,
    palettes: [
      { id: 'signature', name: 'Signature', palette },
      ...input.alternatives.map((alternative) => ({ id: alternative.id, name: alternative.name, palette: derivePalette(alternative.seed) })),
    ],
    type: { ...DEFAULT_TYPE, ...input.type },
    layout: input.layout,
    scene: { ...defaultScene(themeOf(palette.bg)), ...input.scene },
  };
}
