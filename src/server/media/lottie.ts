import sharp from 'sharp';
import { sniffMediaType } from '@/server/domain/media-type';

/**
 * A Lottie animation for a menu's background, checked before it reaches the library (spec
 * 2026-10-18-template-studio-stage-2-scene-files-design.md, 3.3). Lottie is JSON, but a player can run the expressions
 * it carries and load the files it names, so the animation must be data alone: no expression anywhere, pictures
 * embedded and real, no fonts from elsewhere, no sound or video layers. What is stored is the checked JSON, written
 * again without whitespace and without the ids and classes a player would put on the page.
 */

export type LottieRefusal = 'LOTTIE_INVALID' | 'LOTTIE_EXPRESSION' | 'LOTTIE_EXTERNAL' | 'LOTTIE_TOO_COMPLEX';

export interface LottieInfo {
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  layers: number;
}

export const LOTTIE_LIMITS = { side: 4096, durationMs: 60_000, depth: 64, layers: 2000 } as const;

/** Precomposition, solid, image, null, shape and text. Audio (6), video (7), camera (13) and the rest are refused. */
const LAYER_TYPES = new Set([0, 1, 2, 3, 4, 5]);
/** Fields a player puts on the page as an element's id, class or tag, on layers and shapes alike. */
const PAGE_FIELDS = ['ln', 'cl', 'tg'];
const EMBEDDED_IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
/** Font origins that load something: a file (`p`), Google Fonts (`g`), Typekit (`t`), also named by number (3, 1, 2). */
const LOADING_FONT_ORIGINS = new Set(['p', 'g', 't']);
const LOADING_FONT_NUMBERS = new Set([1, 2, 3]);

class Refusal extends Error {
  constructor(
    readonly reason: LottieRefusal,
    detail: string,
  ) {
    super(detail);
  }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Refuses any expression (a string under `x`) and anything nested too deeply, anywhere in the document, and removes the
 * fields a player puts on the page as an element's id, class or tag (layers and shapes both have them).
 */
function walk(value: unknown, depth: number): void {
  if (depth > LOTTIE_LIMITS.depth) throw new Refusal('LOTTIE_TOO_COMPLEX', 'nested too deeply');
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  for (const field of PAGE_FIELDS) delete value[field];
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'x' && typeof entry === 'string') throw new Refusal('LOTTIE_EXPRESSION', 'an expression');
    walk(entry, depth + 1);
  }
}

/** Every layer list: the animation's own and each precomposition's. */
function layerLists(json: Json): Json[][] {
  const lists = [json.layers];
  if (Array.isArray(json.assets)) for (const asset of json.assets) if (isObject(asset) && Array.isArray(asset.layers)) lists.push(asset.layers);
  return lists.map((list) => {
    if (!Array.isArray(list) || !list.every(isObject)) throw new Refusal('LOTTIE_INVALID', 'layers are not objects');
    return list;
  });
}

async function checkImage(asset: Json): Promise<void> {
  const path = typeof asset.p === 'string' ? asset.p : '';
  const embedded = EMBEDDED_IMAGE.exec(path);
  if (asset.e !== 1 || !embedded || (typeof asset.u === 'string' && asset.u !== '')) throw new Refusal('LOTTIE_EXTERNAL', 'an image that is not embedded');
  const bytes = new Uint8Array(Buffer.from(embedded[2]!, 'base64'));
  if (sniffMediaType(bytes.subarray(0, 4096)) !== embedded[1]) throw new Refusal('LOTTIE_INVALID', 'an image that is not its type');
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = await sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata());
  } catch {
    throw new Refusal('LOTTIE_INVALID', 'an image that cannot be read');
  }
  if (!width || !height) throw new Refusal('LOTTIE_INVALID', 'an image without a size');
  if (Math.max(width, height) > LOTTIE_LIMITS.side) throw new Refusal('LOTTIE_TOO_COMPLEX', 'an image too large');
}

/** Checks a Lottie animation and gives back what to store, or why it is refused. */
export async function checkLottie(
  bytes: Uint8Array,
): Promise<{ ok: true; json: string; info: LottieInfo } | { ok: false; reason: LottieRefusal }> {
  try {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''));
    } catch {
      throw new Refusal('LOTTIE_INVALID', 'not JSON');
    }
    if (!isObject(json)) throw new Refusal('LOTTIE_INVALID', 'not an object');
    const { v, fr, ip, op, w, h } = json;
    if (typeof v !== 'string' || !isNumber(fr) || !isNumber(ip) || !isNumber(op) || !isNumber(w) || !isNumber(h) || !Array.isArray(json.layers)) {
      throw new Refusal('LOTTIE_INVALID', 'not a Lottie animation');
    }
    if (fr < 1 || fr > 120 || op <= ip || w < 1 || h < 1) throw new Refusal('LOTTIE_INVALID', 'impossible timing or size');
    if (w > LOTTIE_LIMITS.side || h > LOTTIE_LIMITS.side) throw new Refusal('LOTTIE_TOO_COMPLEX', 'too large');
    const durationMs = Math.round(((op - ip) / fr) * 1000);
    if (durationMs > LOTTIE_LIMITS.durationMs) throw new Refusal('LOTTIE_TOO_COMPLEX', 'too long');

    walk(json, 0);

    const lists = layerLists(json);
    const layers = lists.reduce((sum, list) => sum + list.length, 0);
    if (layers > LOTTIE_LIMITS.layers) throw new Refusal('LOTTIE_TOO_COMPLEX', `${layers} layers`);
    for (const layer of lists.flat()) {
      if (!LAYER_TYPES.has(layer.ty as number)) throw new Refusal('LOTTIE_INVALID', `layer type ${String(layer.ty)}`);
    }

    if (json.assets !== undefined && !Array.isArray(json.assets)) throw new Refusal('LOTTIE_INVALID', 'assets are not a list');
    for (const asset of (json.assets as unknown[] | undefined) ?? []) {
      if (!isObject(asset)) throw new Refusal('LOTTIE_INVALID', 'an asset is not an object');
      if (Array.isArray(asset.layers)) continue;
      await checkImage(asset);
    }

    const fonts = isObject(json.fonts) && Array.isArray(json.fonts.list) ? json.fonts.list : [];
    for (const font of fonts) {
      if (!isObject(font)) throw new Refusal('LOTTIE_INVALID', 'a font is not an object');
      if ((typeof font.fPath === 'string' && font.fPath !== '') || LOADING_FONT_ORIGINS.has(font.fOrigin as string) || LOADING_FONT_NUMBERS.has(font.origin as number)) {
        throw new Refusal('LOTTIE_EXTERNAL', 'a font from elsewhere');
      }
    }

    return { ok: true, json: JSON.stringify(json), info: { width: w, height: h, frameRate: fr, durationMs, layers } };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason };
    return { ok: false, reason: 'LOTTIE_INVALID' };
  }
}
