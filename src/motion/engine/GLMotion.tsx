'use client';

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { PerspectiveCamera, type Camera, type Scene, type WebGLRenderer } from 'three';
import type { MotionProps } from '../types';
import { drawView, sharedRenderer } from './gl';
import { useSurface, type Frame } from './surface';

/** A WebGL motion's scene. Made with the shared renderer (for environment maps and textures), disposed when done. */
export interface GLSketch {
  scene: Scene;
  camera: Camera;
  /** The view changed size (CSS pixels). A perspective camera's aspect is already updated. */
  resize?(width: number, height: number): void;
  update(frame: Frame): void;
  pointerDown?(x: number, y: number): void;
  dispose(): void;
}

export interface GLMotionProps extends MotionProps {
  create: (renderer: WebGLRenderer) => GLSketch;
  /** The CSS colour behind the scene (scenes render on transparent). */
  background?: string;
  still?: number;
  touchAction?: CSSProperties['touchAction'];
  maxSide?: number;
}

const noSubscribe = () => () => {};
const hasRenderer = () => sharedRenderer() !== null;

const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };

/** Runs a `GLSketch` through the shared renderer into a 2D canvas filling the motion's box. */
export function GLMotion({ create, background, still = 1.5, touchAction = 'pan-y', maxSide = 1400, ...motion }: GLMotionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<WebGLRenderer | null>(null);
  const sketch = useRef<{ replay: number; sketch: GLSketch } | null>(null);
  const ctx = useRef<CanvasRenderingContext2D | null>(null);
  const dims = useRef({ width: 0, height: 0 });
  // Whether this device has WebGL, read as an outside store: the server and hydration say yes, the browser then knows.
  const available = useSyncExternalStore(noSubscribe, hasRenderer, () => true);

  useEffect(() => {
    const shared = sharedRenderer();
    if (!shared) return;
    renderer.current = shared;
    return () => {
      sketch.current?.sketch.dispose();
      sketch.current = null;
      renderer.current = null;
    };
  }, []);

  const fit = (target: GLSketch) => {
    const { width, height } = dims.current;
    if (!width) return;
    if (target.camera instanceof PerspectiveCamera) {
      target.camera.aspect = width / height;
      target.camera.updateProjectionMatrix();
    }
    target.resize?.(width, height);
  };

  const current = (): GLSketch | null => {
    const shared = renderer.current;
    if (!shared) return null;
    if (!sketch.current || sketch.current.replay !== motion.replay) {
      sketch.current?.sketch.dispose();
      sketch.current = { replay: motion.replay, sketch: create(shared) };
      fit(sketch.current.sketch);
    }
    return sketch.current.sketch;
  };

  useSurface(canvasRef, {
    playing: motion.playing && available,
    speed: motion.speed,
    progress: motion.progress,
    params: motion.params,
    replay: motion.replay,
    still,
    maxSide,
    ready: () => renderer.current !== null,
    onSize(width, height, ratio) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      dims.current = { width, height };
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.current = canvas.getContext('2d');
      const target = current();
      if (target) fit(target);
    },
    onFrame(frame) {
      const target = current();
      const shared = renderer.current;
      const canvas = canvasRef.current;
      if (!target || !shared || !canvas || !ctx.current) return;
      target.update(frame);
      drawView(shared, target.scene, target.camera, canvas.width, canvas.height, ctx.current);
    },
    onDown(x, y) {
      current()?.pointerDown?.(x, y);
    },
  });

  if (!available) {
    return (
      <div
        aria-hidden
        data-webgl="off"
        style={{ ...FILL, background: `radial-gradient(60% 50% at 50% 45%, rgba(255,255,255,0.14), transparent 70%), ${background ?? '#0d0b09'}` }}
      />
    );
  }
  return <canvas ref={canvasRef} aria-hidden style={{ ...FILL, background, touchAction }} />;
}
