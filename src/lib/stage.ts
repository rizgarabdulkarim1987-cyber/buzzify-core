/**
 * The 3D stage's model, kept free of three.js so it runs on the server, in tests and in the
 * renderer alike. The renderer only draws what `burgerLayers` returns.
 */

export const STAGE_ARTS = ['burger'] as const;
export type StageArt = (typeof STAGE_ARTS)[number];

export function isStageArt(art: string): art is StageArt {
  return (STAGE_ARTS as readonly string[]).includes(art);
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
  | 'bun-top';

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
};

/** Layers from the disc upward. A second patty, bacon and cheese sit under the pickles and top bun. */
export function burgerLayers(selection: BurgerSelection): Layer[] {
  const keys: LayerKind[] = ['bun-bottom', 'lettuce', 'tomato', 'patty'];
  if (selection.patty) keys.push('patty-2');
  if (selection.bacon) keys.push('bacon');
  if (selection.cheese) keys.push('cheese');
  keys.push('pickles', 'bun-top');

  let base = 0;
  return keys.map((key) => {
    const height = HEIGHT[key];
    const layer: Layer = { key, height, y: base + height / 2 };
    base += height;
    return layer;
  });
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
