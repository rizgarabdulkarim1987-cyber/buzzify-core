'use client';

import { canvasMotion } from '../engine/define';
import { hash, lerp, smoothstep, TAU } from '../engine/math';
import { num, str } from '../types';

interface Bean {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  size: number;
  resting: boolean;
  tone: number;
}

const CYCLE = 9;

/** A roasted bean: an oval with a dark seam down its face, lit from the upper left. */
export function drawBean(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, tone = 0.5) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const body = ctx.createRadialGradient(-size * 0.3, -size * 0.4, size * 0.1, 0, 0, size * 1.1);
  body.addColorStop(0, `hsl(24 ${lerp(42, 52, tone)}% ${lerp(42, 34, tone)}%)`);
  body.addColorStop(0.55, `hsl(22 ${lerp(48, 56, tone)}% ${lerp(24, 18, tone)}%)`);
  body.addColorStop(1, `hsl(20 50% ${lerp(11, 8, tone)}%)`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.66, size, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,10,4,0.85)';
  ctx.lineWidth = size * 0.14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.82);
  ctx.bezierCurveTo(-size * 0.28, -size * 0.25, size * 0.28, size * 0.25, 0, size * 0.82);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,180,0.18)';
  ctx.lineWidth = size * 0.06;
  ctx.beginPath();
  ctx.ellipse(-size * 0.22, -size * 0.3, size * 0.18, size * 0.42, 0.3, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * #48 Roasted beans tumbling down: they fall turning, bounce once or twice off the counter and each other, and settle
 * into a heap. When the heap is made the beans are swept away and fall again.
 */
export default canvasMotion(
  (params) => {
    const count = num(params, 'count');
    let beans: Bean[] = [];
    let round = -1;
    let size = { w: 0, h: 0 };
    return {
      resize(width, height) {
        size = { w: width, h: height };
      },
      draw(ctx, frame) {
        const { w, h } = size;
        const s = Math.min(w, h);
        const r = Math.floor(frame.t / CYCLE);
        if (r !== round) {
          round = r;
          beans = Array.from({ length: count }, (_, i) => ({
            x: lerp(0.15, 0.85, hash(i + r * 97, 1)) * w,
            y: -s * (0.1 + hash(i + r * 97, 2) * 1.6),
            vx: (hash(i, 3) - 0.5) * s * 0.2,
            vy: 0,
            angle: hash(i, 4) * TAU,
            spin: (hash(i, 5) - 0.5) * 8,
            size: s * lerp(0.032, 0.045, hash(i, 6)),
            resting: false,
            tone: hash(i, 7),
          }));
        }
        const dt = frame.dt;
        const floor = h * 0.88;
        for (const bean of beans) {
          if (bean.resting || dt === 0) continue;
          bean.vy += s * 3.2 * dt;
          bean.x += bean.vx * dt;
          bean.y += bean.vy * dt;
          bean.angle += bean.spin * dt;
          // The heap: a bean comes to rest on the counter or on a bean already resting under it.
          let ground = floor - bean.size * 0.6;
          for (const other of beans) {
            if (other === bean || !other.resting) continue;
            if (Math.abs(other.x - bean.x) < (other.size + bean.size) * 0.7) ground = Math.min(ground, other.y - (other.size + bean.size) * 0.55);
          }
          if (bean.y > ground) {
            bean.y = ground;
            if (Math.abs(bean.vy) < s * 0.25) {
              bean.resting = true;
              bean.vy = 0;
              bean.vx = 0;
            } else {
              bean.vy *= -0.32;
              bean.vx *= 0.6;
              bean.spin *= 0.5;
            }
          }
        }
        const fade = 1 - smoothstep(CYCLE - 0.8, CYCLE, frame.t % CYCLE);
        ctx.fillStyle = str(frame.params, 'background');
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(80,50,30,0.12)';
        ctx.fillRect(0, floor, w, h - floor);
        ctx.globalAlpha = fade;
        for (const bean of beans) drawBean(ctx, bean.x, bean.y, bean.size, bean.angle, bean.tone);
        ctx.globalAlpha = 1;
      },
    };
  },
  { rebuild: ['count'], still: 4.5 },
);
