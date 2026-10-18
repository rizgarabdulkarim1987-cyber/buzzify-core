'use client';

import type { ComponentType, CSSProperties } from 'react';
import type { WebGLRenderer } from 'three';
import type { MotionParams, MotionProps } from '../types';
import { CanvasMotion, type Sketch } from './canvas';
import { shade } from './color';
import { GLMotion, type GLSketch } from './GLMotion';

interface DefineOptions {
  /** Parameters that change what is built (a dish, an amount): a new value builds the motion again. */
  rebuild?: readonly string[];
  /** The moment, in seconds, a still motion shows. */
  still?: number;
  touchAction?: CSSProperties['touchAction'];
  /** A plain colour behind the drawing instead of the studio's soft pool of light. */
  flat?: boolean;
  maxSide?: number;
}

const keyOf = (params: MotionParams, rebuild: readonly string[] = []) => rebuild.map((name) => String(params[name])).join('|');

/** The ground behind a 3D scene: its background colour with a soft pool of light where the dish stands. */
export function stageGround(color: string): string {
  return `radial-gradient(70% 62% at 50% 46%, ${shade(color, 0.09)} 0%, ${color} 72%)`;
}

const backgroundOf = (params: MotionParams, flat?: boolean): string | undefined => {
  const value = params.background;
  if (typeof value !== 'string') return undefined;
  return flat ? value : stageGround(value);
};

/** A WebGL motion from a scene factory. The factory gets the parameters it is built with; frames get the live ones. */
export function glMotion(create: (renderer: WebGLRenderer, params: MotionParams) => GLSketch, options: DefineOptions = {}): ComponentType<MotionProps> {
  function WebGLMotion(props: MotionProps) {
    return (
      <GLMotion
        key={keyOf(props.params, options.rebuild)}
        {...props}
        background={backgroundOf(props.params, options.flat)}
        still={options.still}
        touchAction={options.touchAction}
        maxSide={options.maxSide}
        create={(renderer) => create(renderer, props.params)}
      />
    );
  }
  return WebGLMotion;
}

/** A 2D canvas motion from a sketch factory. */
export function canvasMotion(create: (params: MotionParams) => Sketch, options: DefineOptions = {}): ComponentType<MotionProps> {
  function Canvas2DMotion(props: MotionProps) {
    return (
      <CanvasMotion
        key={keyOf(props.params, options.rebuild)}
        {...props}
        background={backgroundOf(props.params, options.flat ?? true)}
        still={options.still}
        touchAction={options.touchAction}
        maxSide={options.maxSide}
        create={() => create(props.params)}
      />
    );
  }
  return Canvas2DMotion;
}
