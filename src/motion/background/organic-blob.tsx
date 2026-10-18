'use client';

import { useId, useRef } from 'react';
import { DomStage } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { noise3, TAU } from '../engine/math';
import { str, type MotionProps } from '../types';

const POINTS = 9;

/** A smooth closed path through points around a centre: a Catmull-Rom curve written as cubic Béziers. */
function blobPath(t: number, seed: number, radius: number, wobble: number): string {
  const points = Array.from({ length: POINTS }, (_, i) => {
    const a = (i / POINTS) * TAU;
    const r = radius * (1 + wobble * (noise3(Math.cos(a) + seed, Math.sin(a) + seed, t * 0.25) - 0.5) * 2);
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r] as const;
  });
  let d = `M${points[0]![0].toFixed(2)} ${points[0]![1].toFixed(2)}`;
  for (let i = 0; i < POINTS; i++) {
    const p0 = points[(i - 1 + POINTS) % POINTS]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % POINTS]!;
    const p3 = points[(i + 2) % POINTS]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]!.toFixed(2)} ${c1[1]!.toFixed(2)} ${c2[0]!.toFixed(2)} ${c2[1]!.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return `${d}Z`;
}

/**
 * #88 A soft, living shape: a blob whose outline is never still, swelling here and drawing in there on slow noise, with
 * a second, blurred blob behind it in the other colour, a beat out of step, like a shadow of light.
 */
export default function OrganicBlob({ params, playing, speed, replay }: MotionProps) {
  const id = useId().replace(/:/g, '');
  const front = useRef<SVGPathElement>(null);
  const back = useRef<SVGPathElement>(null);
  useLoop(
    (t) => {
      front.current?.setAttribute('d', blobPath(t, 0, 28, 0.16));
      back.current?.setAttribute('d', blobPath(t * 0.8 + 3, 7, 31, 0.2));
    },
    { playing, speed, replay, still: 2 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={str(params, 'accent')} />
            <stop offset="1" stopColor={str(params, 'color')} />
          </linearGradient>
          <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <path ref={back} fill={str(params, 'accent')} opacity="0.55" filter={`url(#${id}-soft)`} />
        <path ref={front} fill={`url(#${id}-fill)`} />
      </svg>
    </DomStage>
  );
}
