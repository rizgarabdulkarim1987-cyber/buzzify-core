'use client';

import { useRef } from 'react';
import { inkOn, rgba, shade } from '../engine/color';
import { CENTER, DomStage } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { easeOutCubic, hash } from '../engine/math';
import { str, type MotionProps } from '../types';

interface Ripple {
  x: number;
  y: number;
  born: number;
}

const LIFE = 1.1;

/**
 * #72 A surface that answers a touch with ripples: each press sends out a ring from exactly where it landed, which
 * spreads across the surface and fades. Untouched, the surface is tapped now and then by itself.
 */
export default function TouchRipple({ params, playing, speed, replay }: MotionProps) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<Ripple[]>([]);
  const clock = useRef({ t: 0, nextTap: 0.4, taps: 0, lastReal: -10 });
  const colour = str(params, 'color');
  const background = str(params, 'background');
  useLoop(
    (t) => {
      const c = clock.current;
      c.t = t;
      const box = surface.current?.getBoundingClientRect();
      const el = canvas.current;
      if (!box || !el) return;
      if (el.width !== Math.round(box.width)) {
        el.width = Math.round(box.width);
        el.height = Math.round(box.height);
      }
      if (t >= c.nextTap && t - c.lastReal > 2.5) {
        ripples.current.push({ x: (0.2 + hash(c.taps, 1) * 0.6) * box.width, y: (0.2 + hash(c.taps, 2) * 0.6) * box.height, born: t });
        c.taps += 1;
        c.nextTap = t + 0.8 + hash(c.taps, 3) * 0.6;
      }
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, el.width, el.height);
      ripples.current = ripples.current.filter((r) => t - r.born < LIFE);
      const reach = Math.hypot(box.width, box.height) * 0.6;
      for (const r of ripples.current) {
        const k = (t - r.born) / LIFE;
        const radius = easeOutCubic(k) * reach;
        const fill = ctx.createRadialGradient(r.x, r.y, radius * 0.6, r.x, r.y, radius);
        fill.addColorStop(0, rgba(colour, 0));
        fill.addColorStop(0.9, rgba(colour, 0.32 * (1 - k)));
        fill.addColorStop(1, rgba(colour, 0));
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { playing, speed, replay, still: 1.2 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={shade(background, -0.3)}>
      <div style={CENTER}>
        <div
          ref={surface}
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            ripples.current.push({ x: event.clientX - box.left, y: event.clientY - box.top, born: clock.current.t });
            clock.current.lastReal = clock.current.t;
          }}
          style={{ position: 'relative', width: '70cqw', height: '56cqh', borderRadius: '3cqmin', background, overflow: 'hidden', cursor: 'pointer', boxShadow: `inset 0 0 0 1px ${rgba(inkOn(background), 0.12)}` }}
        >
          <canvas ref={canvas} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </div>
      </div>
    </DomStage>
  );
}
