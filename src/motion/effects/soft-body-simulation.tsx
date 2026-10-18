'use client';

import { rgba, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { TAU } from '../engine/math';
import { str } from '../types';

const POINTS = 28;
const CYCLE = 4.5;

interface Mass {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * #142 A jelly dropped on a plate: a ring of masses held by springs and inflated by pressure, so it falls round, splats
 * on landing, wobbles back and forth and settles into a dome. Then it is lifted and dropped again.
 */
export default canvasMotion(() => {
  let ring: Mass[] = [];
  let round = -1;
  let radius = 40;
  let rest = 10;
  let floor = 0;
  const reset = (w: number, h: number) => {
    radius = Math.min(w, h) * 0.16;
    rest = (TAU * radius) / POINTS;
    floor = h * 0.84;
    ring = Array.from({ length: POINTS }, (_, i) => {
      const a = (i / POINTS) * TAU;
      return { x: w / 2 + Math.cos(a) * radius, y: h * 0.2 + Math.sin(a) * radius, vx: 0, vy: 0 };
    });
  };
  const area = () => {
    let sum = 0;
    for (let i = 0; i < POINTS; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % POINTS]!;
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  };
  return {
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const r = Math.floor(t / CYCLE);
      if (r !== round || !ring.length) {
        round = r;
        reset(w, h);
      }
      const target = Math.PI * radius * radius;
      const steps = Math.max(1, Math.ceil(frame.dt / (1 / 240)));
      const dt = frame.dt / steps;
      for (let s = 0; s < steps && dt > 0; s++) {
        const pressure = (target / Math.max(1, area()) - 1) * 900;
        for (let i = 0; i < POINTS; i++) {
          const a = ring[i]!;
          const prev = ring[(i - 1 + POINTS) % POINTS]!;
          const next = ring[(i + 1) % POINTS]!;
          // Springs to the neighbours, and the pressure pushing out along the ring's normal.
          let fx = 0;
          let fy = 0;
          for (const n of [prev, next]) {
            const dx = n.x - a.x;
            const dy = n.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            fx += (dx / d) * (d - rest) * 600;
            fy += (dy / d) * (d - rest) * 600;
          }
          const nx = next.y - prev.y;
          const ny = -(next.x - prev.x);
          fx += nx * pressure * 0.08;
          fy += ny * pressure * 0.08;
          a.vx += fx * dt;
          a.vy += (fy + h * 2.2) * dt;
          a.vx *= 0.995;
          a.vy *= 0.995;
        }
        for (const a of ring) {
          a.x += a.vx * dt;
          a.y += a.vy * dt;
          if (a.y > floor) {
            a.y = floor;
            a.vy *= -0.2;
            a.vx *= 0.9;
          }
        }
      }
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      // The plate.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(w / 2, floor + 4, Math.min(w, h) * 0.34, Math.min(w, h) * 0.04, 0, 0, TAU);
      ctx.fill();
      const colour = str(params, 'color');
      const cx = ring.reduce((s, m) => s + m.x, 0) / POINTS;
      const cy = ring.reduce((s, m) => s + m.y, 0) / POINTS;
      const body = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.1, cx, cy, radius * 1.4);
      body.addColorStop(0, shade(colour, 0.45));
      body.addColorStop(0.5, colour);
      body.addColorStop(1, shade(colour, -0.35));
      ctx.fillStyle = body;
      ctx.beginPath();
      // A smooth closed curve through the ring: midpoints joined by quadratic curves.
      for (let i = 0; i <= POINTS; i++) {
        const a = ring[i % POINTS]!;
        const b = ring[(i + 1) % POINTS]!;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.quadraticCurveTo(a.x, a.y, mx, my);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.45);
      ctx.beginPath();
      ctx.ellipse(cx - radius * 0.35, cy - radius * 0.45, radius * 0.22, radius * 0.1, -0.5, 0, TAU);
      ctx.fill();
    },
  };
}, { still: 3 });
