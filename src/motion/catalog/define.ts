import type { MotionCategory, MotionDrive, MotionMeta, ParamSpec, TextSample } from '../types';

/** The house palette the motions start from: a warm dark room, cream, espresso and gold. */
export const PALETTE = {
  ink: '#0d0b09',
  night: '#14110e',
  espresso: '#3b2416',
  roast: '#2b1a12',
  cream: '#f4ead9',
  milk: '#fbf7f0',
  gold: '#d4a64a',
  amber: '#f2b705',
  cherry: '#c2352b',
  berry: '#b03a5b',
  honey: '#e8a317',
  chocolate: '#4a2617',
  pistachio: '#a3b86c',
  mint: '#7fc8a9',
  sky: '#6fa8dc',
  violet: '#6b4fa0',
  teal: '#2a7f7f',
  rose: '#f4a7b9',
} as const;

export const color = (value: string): ParamSpec => ({ type: 'color', default: value });
export const range = (value: number, min: number, max: number, step: number): ParamSpec => ({ type: 'range', default: value, min, max, step });
export const toggle = (value: boolean): ParamSpec => ({ type: 'toggle', default: value });
export const choice = (value: string, options: readonly string[]): ParamSpec => ({ type: 'choice', default: value, options });
export const text = (value: string, maxLength: number, sample?: TextSample): ParamSpec => ({
  type: 'text',
  default: value,
  maxLength,
  ...(sample ? { sample } : {}),
});

/** The dishes the 3D motions can stage (procedural models of the menu's 3D stage). */
export const MODELS = ['burger', 'cup', 'croissant', 'glass', 'millefeuille'] as const;
export const model = (value: (typeof MODELS)[number]): ParamSpec => choice(value, MODELS);

/** Type faces the typography motions offer. Arabic-script text falls back to the page's Arabic face. */
export const font = (value: 'serif' | 'sans' | 'condensed' = 'serif'): ParamSpec => choice(value, ['serif', 'sans', 'condensed']);

type Short = 'dom' | 'canvas' | 'webgl';

/** One group's motions, numbered on from `first`. */
export function group(
  category: MotionCategory,
  first: number,
  entries: ReadonlyArray<readonly [id: string, engine: Short, drive: MotionDrive, params?: Record<string, ParamSpec>]>,
): MotionMeta[] {
  return entries.map(([id, engine, drive, params = {}], index) => ({ id, number: first + index, category, engine, drive, params }));
}
