import type { MotionValue } from './motion-value';

/**
 * The motion library's vocabulary. A motion is described by plain data (`MotionMeta`), so the catalog can be read on the
 * server, in tests and in the Studio's gallery without loading any motion's code; the code itself (`MotionProps` in, a
 * React element out) is loaded on demand, one file per motion.
 */

/** The list's ten groups, in its order. Each holds fifteen motions. */
export const MOTION_CATEGORIES = [
  'three-d',
  'scroll',
  'luxury',
  'food',
  'interactive',
  'background',
  'micro',
  'type',
  'transition',
  'effects',
] as const;
export type MotionCategory = (typeof MOTION_CATEGORIES)[number];

/** How a motion is drawn: elements and CSS, a 2D canvas, or WebGL through the shared renderer. */
export type MotionEngine = 'dom' | 'canvas' | 'webgl';

/**
 * What moves a motion: its own clock; a progress from 0 to 1 that something else owns (the scroll, a page transition);
 * or the pointer. Pointer motions play a gentle synthetic pointer of their own when nobody is pointing at them.
 */
export type MotionDrive = 'time' | 'progress' | 'pointer';

export const MOTION_ENGINES: readonly MotionEngine[] = ['dom', 'canvas', 'webgl'];
export const MOTION_DRIVES: readonly MotionDrive[] = ['time', 'progress', 'pointer'];

/** Sample texts the Studio fills a text parameter with, in the Studio's language. */
export type TextSample = 'headline' | 'word' | 'brand' | 'words' | 'action';
export const TEXT_SAMPLES: readonly TextSample[] = ['headline', 'word', 'brand', 'words', 'action'];

export type ParamSpec =
  | { type: 'color'; default: string }
  | { type: 'range'; default: number; min: number; max: number; step: number }
  | { type: 'toggle'; default: boolean }
  | { type: 'choice'; default: string; options: readonly string[] }
  | { type: 'text'; default: string; maxLength: number; sample?: TextSample };

export type ParamValue = string | number | boolean;
export type MotionParams = Record<string, ParamValue>;

export interface MotionMeta {
  id: string;
  /** Its number in the list, 1 to 150. */
  number: number;
  category: MotionCategory;
  engine: MotionEngine;
  drive: MotionDrive;
  params: Record<string, ParamSpec>;
}

/** What every motion component receives. */
export interface MotionProps {
  /** Every parameter, resolved: defaults filled in and values checked (`resolveParams`). */
  params: MotionParams;
  /** False shows a still frame: off screen, reduced motion, or paused by the viewer. */
  playing: boolean;
  /** 1 is the motion's own pace. */
  speed: number;
  /** From 0 to 1. Progress motions draw from it; the others may ignore it. */
  progress: MotionValue<number>;
  /** Changes when the viewer asks to see a motion again from its start. */
  replay: number;
  /** The reading direction of the page the motion sits on; sideways motion follows it. */
  dir: 'ltr' | 'rtl';
}

/** A param spec read as a number, for motions that know their own specs. */
export const num = (params: MotionParams, key: string): number => Number(params[key]);
export const str = (params: MotionParams, key: string): string => String(params[key]);
export const bool = (params: MotionParams, key: string): boolean => params[key] === true;
