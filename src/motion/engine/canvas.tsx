'use client';

import { useRef, type CSSProperties } from 'react';
import type { MotionProps } from '../types';
import { useSurface, type Frame } from './surface';

export type { Frame };

/** A canvas motion's drawing code. Created once per run (and again on replay), it keeps its own state. */
export interface Sketch {
  /** The canvas changed size (CSS pixels). The context is already scaled to device pixels. */
  resize?(width: number, height: number): void;
  draw(ctx: CanvasRenderingContext2D, frame: Frame): void;
  /** A press on the canvas, in CSS pixels. */
  pointerDown?(x: number, y: number): void;
}

export interface CanvasMotionProps extends MotionProps {
  create: () => Sketch;
  /** The CSS colour behind the drawing. */
  background?: string;
  still?: number;
  /** How touches on the canvas behave: `pan-y` keeps a page scrolling; drag motions take `none`. */
  touchAction?: CSSProperties['touchAction'];
  maxSide?: number;
}

const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };

/** Runs a `Sketch` on a 2D canvas that fills the motion's box. */
export function CanvasMotion({ create, background, still = 1.5, touchAction = 'pan-y', maxSide, ...motion }: CanvasMotionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sketch = useRef<{ replay: number; sketch: Sketch } | null>(null);
  const ctx = useRef<CanvasRenderingContext2D | null>(null);
  const dims = useRef({ width: 0, height: 0, ratio: 1 });

  const current = (): Sketch => {
    if (!sketch.current || sketch.current.replay !== motion.replay) {
      sketch.current = { replay: motion.replay, sketch: create() };
      if (dims.current.width) sketch.current.sketch.resize?.(dims.current.width, dims.current.height);
    }
    return sketch.current.sketch;
  };

  useSurface(canvasRef, {
    playing: motion.playing,
    speed: motion.speed,
    progress: motion.progress,
    params: motion.params,
    replay: motion.replay,
    still,
    maxSide,
    onSize(width, height, ratio) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      dims.current = { width, height, ratio };
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.current = canvas.getContext('2d');
      ctx.current?.setTransform(ratio, 0, 0, ratio, 0, 0);
      current().resize?.(width, height);
    },
    onFrame(frame) {
      const context = ctx.current;
      if (!context) return;
      context.setTransform(dims.current.ratio, 0, 0, dims.current.ratio, 0, 0);
      current().draw(context, frame);
    },
    onDown(x, y) {
      current().pointerDown?.(x, y);
    },
  });

  return <canvas ref={canvasRef} aria-hidden style={{ ...FILL, background, touchAction }} />;
}
