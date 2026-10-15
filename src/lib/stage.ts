import type { MediaItem } from './media';

/**
 * The 3D stage's model, kept free of three.js so it runs on the server, in tests and in the
 * renderer alike. The renderer only draws what `layersFor` returns.
 */

/** The models the stage can draw. A product's media picks one by art kind or by an explicit `model`. */
export const STAGE_ARTS = ['burger', 'cup', 'glass', 'croissant', 'millefeuille'] as const;
export type StageArt = (typeof STAGE_ARTS)[number];

export function isStageArt(art: string): art is StageArt {
  return (STAGE_ARTS as readonly string[]).includes(art);
}

/** The model an art kind means when the media item names none. */
const DEFAULT_MODEL: Partial<Record<string, StageArt>> = { burger: 'burger', cup: 'cup', glass: 'glass' };

/** The model and colour when a product's media can be shown as a 3D stage, otherwise null. */
export function stageOf(media: ReadonlyArray<MediaItem>): { art: StageArt; tone: string } | null {
  const first = media[0];
  if (!first || first.kind !== 'art') return null;
  const named = first.model && isStageArt(first.model) ? first.model : undefined;
  const art = named ?? DEFAULT_MODEL[first.art];
  return art ? { art, tone: first.tone } : null;
}

/** The art colour when a product's media can be shown as a 3D stage, otherwise null. */
export function stageTone(media: ReadonlyArray<MediaItem>): string | null {
  return stageOf(media)?.tone ?? null;
}

export type LayerKind =
  | 'bun-bottom'
  | 'lettuce'
  | 'tomato'
  | 'patty'
  | 'patty-2'
  | 'bacon'
  | 'cheese'
  | 'pickles'
  | 'bun-top'
  | 'saucer'
  | 'cup'
  | 'coffee'
  | 'glass'
  | 'liquid'
  | 'ice'
  | 'lemon'
  | 'croissant'
  | 'puff-1'
  | 'cream-1'
  | 'puff-2'
  | 'cream-2'
  | 'puff-3'
  | 'icing';

export interface Layer {
  key: LayerKind;
  /** Centre of the layer above the disc, in model units (the burger's outer radius is 1). */
  y: number;
  height: number;
}

export interface BurgerSelection {
  cheese: boolean;
  patty: boolean;
  bacon: boolean;
}

export const NO_EXTRAS: BurgerSelection = { cheese: false, patty: false, bacon: false };

const HEIGHT: Record<LayerKind, number> = {
  'bun-bottom': 0.34,
  lettuce: 0.1,
  tomato: 0.09,
  patty: 0.26,
  'patty-2': 0.26,
  bacon: 0.06,
  cheese: 0.05,
  pickles: 0.06,
  'bun-top': 0.52,
  saucer: 0.085,
  cup: 0.6,
  coffee: 0.04,
  glass: 1.1,
  liquid: 0.86,
  ice: 0.5,
  lemon: 0.06,
  croissant: 0.52,
  'puff-1': 0.12,
  'cream-1': 0.09,
  'puff-2': 0.12,
  'cream-2': 0.09,
  'puff-3': 0.12,
  icing: 0.05,
};

function stack(keys: LayerKind[]): Layer[] {
  let base = 0;
  return keys.map((key) => {
    const height = HEIGHT[key];
    const layer: Layer = { key, height, y: base + height / 2 };
    base += height;
    return layer;
  });
}

/** Layers from the disc upward. A second patty, bacon and cheese sit under the pickles and top bun. */
export function burgerLayers(selection: BurgerSelection): Layer[] {
  const keys: LayerKind[] = ['bun-bottom', 'lettuce', 'tomato', 'patty'];
  if (selection.patty) keys.push('patty-2');
  if (selection.bacon) keys.push('bacon');
  if (selection.cheese) keys.push('cheese');
  keys.push('pickles', 'bun-top');
  return stack(keys);
}

/**
 * A cup of coffee: saucer, cup, and the drink inside the cup. The coffee sits inside the cup's
 * height rather than above it, so these layers are nested, not stacked.
 */
export function cupLayers(): Layer[] {
  const saucer = HEIGHT.saucer;
  const cup = HEIGHT.cup;
  const coffee = HEIGHT.coffee;
  return [
    { key: 'saucer', height: saucer, y: saucer / 2 },
    { key: 'cup', height: cup, y: saucer + cup / 2 },
    { key: 'coffee', height: coffee, y: saucer + cup * 0.83 },
  ];
}

/** A tumbler with the drink, ice floating in it and a lemon wheel on the rim. Nested, like the cup. */
export function glassLayers(): Layer[] {
  return [
    { key: 'glass', height: HEIGHT.glass, y: HEIGHT.glass / 2 },
    { key: 'liquid', height: HEIGHT.liquid, y: 0.1 + HEIGHT.liquid / 2 },
    { key: 'ice', height: HEIGHT.ice, y: 0.66 },
    { key: 'lemon', height: HEIGHT.lemon, y: 1.12 },
  ];
}

export function croissantLayers(): Layer[] {
  return [{ key: 'croissant', height: HEIGHT.croissant, y: HEIGHT.croissant / 2 }];
}

/** Three sheets of puff pastry with cream between them, iced on top. */
export function millefeuilleLayers(): Layer[] {
  return stack(['puff-1', 'cream-1', 'puff-2', 'cream-2', 'puff-3', 'icing']);
}

/** The layers a stage draws for a model. Only burgers react to the selection. */
export function layersFor(art: StageArt, selection: BurgerSelection): Layer[] {
  switch (art) {
    case 'burger':
      return burgerLayers(selection);
    case 'cup':
      return cupLayers();
    case 'glass':
      return glassLayers();
    case 'croissant':
      return croissantLayers();
    case 'millefeuille':
      return millefeuilleLayers();
  }
}

/**
 * How far a layer moves (up is positive) when the model is pulled apart at full "what's inside".
 * Stacks spread upward from their base; nested models lift their parts off one another.
 */
export function explodeOffset(art: StageArt, layers: readonly Layer[], key: LayerKind): number {
  switch (art) {
    case 'burger':
    case 'millefeuille': {
      // The base stays on its plinth and everything above it spreads upward in proportion to its height.
      const layer = layers.find((candidate) => candidate.key === key);
      const first = layers[0];
      if (!layer || !first) return 0;
      return (layer.y - first.y) * 0.85;
    }
    case 'cup':
      return key === 'cup' || key === 'coffee' ? 0.45 : 0;
    case 'glass':
      return key === 'lemon' ? 0.55 : key === 'ice' ? 0.4 : key === 'liquid' ? 0.05 : 0;
    case 'croissant':
      return 0;
  }
}

/** Turns the options a customer has chosen into what the model should show. */
export function selectionFromOptions(
  options: ReadonlyArray<{ id: string; visualKey: string | null }>,
  selectedIds: readonly string[],
): BurgerSelection {
  const chosen = new Set(selectedIds);
  const selection: BurgerSelection = { ...NO_EXTRAS };
  for (const option of options) {
    if (!chosen.has(option.id)) continue;
    if (option.visualKey === 'cheese') selection.cheese = true;
    else if (option.visualKey === 'patty') selection.patty = true;
    else if (option.visualKey === 'bacon') selection.bacon = true;
  }
  return selection;
}

/**
 * Whether a drink gets latte art. Milk drinks and matcha are warm, soft tones; espresso is darker and
 * tea more saturated, so they stay plain. A rule on the colour is a stand-in until options can say
 * what a drink is.
 */
export function drinkStyle(tone: string): 'art' | 'plain' {
  const match = /^#([0-9a-f]{6})$/i.exec(tone);
  if (!match) return 'plain';
  const value = parseInt(match[1]!, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  if (hue >= 60 && hue <= 170) return 'art'; // matcha green
  return saturation <= 0.33 && lightness >= 0.34 && lightness <= 0.48 ? 'art' : 'plain';
}

export interface StageEnvironment {
  webgl: boolean;
  saveData: boolean;
  /** `navigator.deviceMemory` in GB when the browser exposes it. */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency` when the browser exposes it. */
  cores?: number;
  /** A visitor's explicit choice, from `?stage=on|off`. */
  forced?: 'on' | 'off';
}

export const MIN_DEVICE_MEMORY_GB = 4;
export const MIN_CORES = 4;

/** Whether this device should load the 3D stage. Without WebGL it never can. */
export function qualifiesFor3D(env: StageEnvironment): boolean {
  if (!env.webgl) return false;
  if (env.forced === 'off') return false;
  if (env.forced === 'on') return true;
  if (env.saveData) return false;
  if (env.deviceMemory !== undefined && env.deviceMemory < MIN_DEVICE_MEMORY_GB) return false;
  if (env.cores !== undefined && env.cores < MIN_CORES) return false;
  return true;
}
