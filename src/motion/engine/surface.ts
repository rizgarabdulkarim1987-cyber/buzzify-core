'use client';

import type { MotionValue } from 'motion/react';
import { useEffect, useRef, type RefObject } from 'react';
import type { MotionParams } from '../types';
import { ghost, useIsoLayoutEffect, useLatest, usePointer, type PointerState } from './loop';
import { onTick } from './ticker';

/** What a canvas or WebGL motion draws from on each frame. Lengths are CSS pixels. */
export interface Frame {
  /** The motion's own seconds, scaled by speed. */
  t: number;
  /** Seconds since the last frame, scaled by speed; 0 for a still frame. */
  dt: number;
  width: number;
  height: number;
  /** From 0 to 1, for progress motions. */
  progress: number;
  /** The real pointer when `pointer.inside`; otherwise a slow synthetic one. */
  pointer: PointerState;
  params: MotionParams;
}

export interface SurfaceOptions {
  playing: boolean;
  speed: number;
  progress: MotionValue<number>;
  params: MotionParams;
  replay: number;
  /** The moment a still surface shows, reached by stepping the motion forward (simulations need their history). */
  still: number;
  /** The largest side in device pixels: a big stage on a 2x screen draws at less than 2x rather than at 4 million pixels. */
  maxSide?: number;
  onSize(width: number, height: number, pixelRatio: number): void;
  onFrame(frame: Frame): void;
  onDown?(x: number, y: number): void;
  /** Whether there is anything to draw yet (a WebGL scene still being built). */
  ready?: () => boolean;
}

const STILL_STEP = 1 / 30;
const MAX_WARMUP_STEPS = 120;

/**
 * The loop shared by canvas and WebGL motions: keeps the canvas at its box's size in device pixels, steps the motion
 * while it plays, draws one still frame when it does not, and reports the pointer (or a synthetic one).
 */
export function useSurface(canvasRef: RefObject<HTMLCanvasElement | null>, options: SurfaceOptions): void {
  const opts = useLatest(options);
  const pointer = usePointer(canvasRef, (x, y) => opts.current.onDown?.(x, y));
  const size = useRef({ width: 0, height: 0 });
  const time = useRef(0);

  const frame = (dt: number): Frame => {
    const o = opts.current;
    const { width, height } = size.current;
    const real = pointer.current;
    let shown: PointerState = real;
    if (!real.inside) {
      const [gx, gy] = ghost(time.current);
      shown = { x: gx * width, y: gy * height, inside: false, down: false };
    }
    return { t: time.current, dt, width, height, progress: o.progress.get(), pointer: shown, params: o.params };
  };

  const drawStill = () => {
    const o = opts.current;
    if (size.current.width === 0 || (o.ready && !o.ready())) return;
    let steps = 0;
    while (time.current < o.still && steps < MAX_WARMUP_STEPS) {
      time.current = Math.min(o.still, time.current + STILL_STEP);
      o.onFrame(frame(STILL_STEP));
      steps += 1;
    }
    o.onFrame(frame(0));
  };

  useIsoLayoutEffect(() => {
    time.current = 0;
  }, [options.replay]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      const maxSide = opts.current.maxSide ?? 1800;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, maxSide / Math.max(width, height));
      size.current = { width, height };
      opts.current.onSize(width, height, ratio);
      if (!opts.current.playing) drawStill();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
    // The surface measures itself once per canvas; options are read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  useEffect(() => {
    if (!options.playing) return;
    return onTick((dt) => {
      const o = opts.current;
      if (size.current.width === 0 || (o.ready && !o.ready())) return;
      const step = dt * o.speed;
      time.current += step;
      o.onFrame(frame(step));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.playing, options.replay]);

  // A still surface follows its controls: redraw after every render while not playing.
  useEffect(() => {
    if (!options.playing) drawStill();
  });
}
