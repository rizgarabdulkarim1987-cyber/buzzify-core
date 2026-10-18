'use client';

import { shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { hash, lerp, TAU } from '../engine/math';
import { num, str } from '../types';

const SHELLS = ['#f4a7b9', '#a3b86c', '#f2c94c', '#c9a0dc', '#f7d6b0', '#8fc1e3'];
const CYCLE = 8;

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  r: number;
  shell: string;
}

/** A macaron seen from the side, turned by `angle`: two domed shells and the filling between. */
function macaron(ctx: CanvasRenderingContext2D, body: Body) {
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);
  const r = body.r;
  ctx.fillStyle = shade(body.shell, -0.12);
  ctx.beginPath();
  ctx.ellipse(0, r * 0.32, r, r * 0.42, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#fbf3e4';
  ctx.fillRect(-r * 0.92, -r * 0.12, r * 1.84, r * 0.34);
  const top = ctx.createLinearGradient(0, -r * 0.7, 0, 0);
  top.addColorStop(0, shade(body.shell, 0.25));
  top.addColorStop(1, body.shell);
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.12, r, r * 0.5, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = shade(body.shell, -0.2);
  ctx.fillRect(-r * 0.98, -r * 0.16, r * 1.96, r * 0.08);
  ctx.restore();
}

/**
 * #143 Macarons tipped onto the counter: each is a rigid body that falls, knocks into the others and rolls, turning by
 * exactly the distance it covers, until friction brings it to rest. Then they are swept up and tipped out again.
 */
export default canvasMotion(
  (params) => {
    const count = num(params, 'count');
    let bodies: Body[] = [];
    let round = -1;
    return {
      draw(ctx, frame) {
        const { width: w, height: h, t } = frame;
        const s = Math.min(w, h);
        const r = Math.floor(t / CYCLE);
        if (r !== round) {
          round = r;
          bodies = Array.from({ length: count }, (_, i) => ({
            x: lerp(0.2, 0.8, hash(i + r * 31, 1)) * w,
            y: -s * (0.1 + i * 0.12),
            vx: (hash(i, 2) - 0.5) * s * 0.4,
            vy: 0,
            angle: hash(i, 3) * TAU,
            spin: 0,
            r: s * lerp(0.05, 0.065, hash(i, 4)),
            shell: SHELLS[i % SHELLS.length]!,
          }));
        }
        const floor = h * 0.86;
        const steps = Math.max(1, Math.ceil(frame.dt / (1 / 240)));
        const dt = frame.dt / steps;
        for (let k = 0; k < steps && dt > 0; k++) {
          for (const b of bodies) {
            b.vy += s * 3 * dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.angle += b.spin * dt;
            if (b.y > floor - b.r * 0.45) {
              b.y = floor - b.r * 0.45;
              if (b.vy > 0) b.vy *= -0.25;
              // Rolling without slipping on the counter: spin follows speed, friction slows both.
              b.vx *= 1 - 2.2 * dt;
              b.spin = b.vx / b.r;
            }
            if (b.x < b.r) {
              b.x = b.r;
              b.vx = Math.abs(b.vx) * 0.5;
            }
            if (b.x > w - b.r) {
              b.x = w - b.r;
              b.vx = -Math.abs(b.vx) * 0.5;
            }
          }
          for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
              const a = bodies[i]!;
              const c = bodies[j]!;
              const dx = c.x - a.x;
              const dy = c.y - a.y;
              const d = Math.hypot(dx, dy) || 1;
              const min = (a.r + c.r) * 0.82;
              if (d < min) {
                const nx = dx / d;
                const ny = dy / d;
                const push = (min - d) / 2;
                a.x -= nx * push;
                a.y -= ny * push;
                c.x += nx * push;
                c.y += ny * push;
                const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
                if (rel < 0) {
                  const impulse = (-1.3 * rel) / 2;
                  a.vx -= nx * impulse;
                  a.vy -= ny * impulse;
                  c.vx += nx * impulse;
                  c.vy += ny * impulse;
                  a.spin -= impulse / a.r * 0.3;
                  c.spin += impulse / c.r * 0.3;
                }
              }
            }
          }
        }
        ctx.fillStyle = str(frame.params, 'background');
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(60,40,20,0.1)';
        ctx.fillRect(0, floor, w, h - floor);
        for (const b of bodies) macaron(ctx, b);
      },
    };
  },
  { rebuild: ['count'], still: 4 },
);
