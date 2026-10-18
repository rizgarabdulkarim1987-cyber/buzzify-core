'use client';

import { rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { FONTS } from '../engine/fonts';
import { textPoints } from '../engine/shapes';
import { str } from '../types';

interface Particle {
  hx: number;
  hy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * #150 A word made of particles that the hand can scatter: near the pointer they are pushed away, and every one is
 * tied to its home by a spring and slowed by drag, so the word reforms as soon as the pointer passes.
 */
export default canvasMotion(
  (params) => {
    const word = str(params, 'text');
    let particles: Particle[] = [];
    let size = { width: 0, height: 0 };
    let dot = 2;
    const build = () => {
      if (!size.width) return;
      const step = Math.max(3, Math.round(Math.min(size.width, size.height) / 85));
      dot = step * 0.8;
      particles = textPoints(word, FONTS.serif!, size.width, size.height, step, 0.42).map(([x, y]) => ({ hx: x, hy: y, x, y, vx: 0, vy: 0 }));
    };
    if (typeof document !== 'undefined') void document.fonts?.load(`600 48px ${FONTS.serif}`, word).then(build, build);
    return {
      resize(width, height) {
        size = { width, height };
        build();
      },
      draw(ctx, frame) {
        const { width: w, height: h, pointer, params: live } = frame;
        const colour = str(live, 'color');
        ctx.fillStyle = str(live, 'background');
        ctx.fillRect(0, 0, w, h);
        const reach = Math.min(w, h) * 0.16;
        const dt = Math.min(frame.dt, 1 / 30);
        for (const p of particles) {
          if (dt > 0) {
            const dx = p.x - pointer.x;
            const dy = p.y - pointer.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < reach) {
              const push = (1 - d / reach) ** 2 * 5200;
              p.vx += (dx / d) * push * dt;
              p.vy += (dy / d) * push * dt;
            }
            p.vx += (p.hx - p.x) * 38 * dt;
            p.vy += (p.hy - p.y) * 38 * dt;
            p.vx *= Math.exp(-6 * dt);
            p.vy *= Math.exp(-6 * dt);
            p.x += p.vx * dt;
            p.y += p.vy * dt;
          }
          const away = Math.min(1, Math.hypot(p.x - p.hx, p.y - p.hy) / reach);
          ctx.fillStyle = away > 0.05 ? rgba(colour, 1 - away * 0.4) : colour;
          ctx.fillRect(p.x, p.y, dot, dot);
        }
        // A faint ring where the pointer is, so the force has a place.
        ctx.strokeStyle = rgba(colour, pointer.inside ? 0.25 : 0.12);
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, reach * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      },
    };
  },
  { rebuild: ['text'], still: 1.5 },
);
