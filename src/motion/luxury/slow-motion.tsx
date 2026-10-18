'use client';

import { mix, rgba, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { clamp, hash, lerp, smoothstep, TAU } from '../engine/math';
import { num, str } from '../types';

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alive: boolean;
}

/** One take, in the film's own (slowed) seconds: the bean falls, hits, the crown rises and falls, the jet. */
const TAKE = 2.4;
const GRAVITY = 2.6;

/**
 * #33 A coffee bean dropped into a full cup, filmed at high speed: it falls, the surface caves, a crown of droplets
 * lifts and breaks, and a jet rises from the middle. `intensity` is how slow the camera runs: at full, time crawls.
 */
export default canvasMotion(() => {
  let drops: Drop[] = [];
  let film = 0;
  let take = -1;
  return {
    draw(ctx, frame) {
      const { width: w, height: h, params } = frame;
      const coffee = str(params, 'color');
      const background = str(params, 'background');
      const slow = lerp(0.6, 0.08, num(params, 'intensity'));
      film += frame.dt * slow;
      const local = film % TAKE;
      const round = Math.floor(film / TAKE);
      const s = Math.min(w, h);
      const surface = h * 0.62;
      const cx = w / 2;
      const hit = 0.55;
      if (round !== take) {
        take = round;
        drops = Array.from({ length: 46 }, (_, i) => {
          const a = Math.PI * (0.08 + 0.84 * hash(i + round * 50, 1));
          const speed = s * (0.55 + hash(i + round * 50, 2) * 0.55);
          return { x: cx + Math.cos(a) * s * 0.05, y: surface, vx: Math.cos(a) * speed * 0.55, vy: -Math.sin(a) * speed, r: s * (0.004 + hash(i, 3) * 0.009), alive: false };
        });
      }
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
      // The coffee, in cross-section: a dark body with a crema line, caving in at the impact.
      const crater = local > hit ? Math.sin(clamp((local - hit) / 0.9) * Math.PI) * s * 0.07 : 0;
      const body = ctx.createLinearGradient(0, surface, 0, h);
      body.addColorStop(0, shade(coffee, 0.25));
      body.addColorStop(0.06, coffee);
      body.addColorStop(1, shade(coffee, -0.45));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(0, surface);
      for (let x = 0; x <= w; x += 4) {
        const d = (x - cx) / (s * 0.16);
        ctx.lineTo(x, surface + crater * Math.exp(-d * d) - Math.sin(local * 9 - Math.abs(x - cx) * 0.05) * (crater * 0.15));
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
      // The bean, falling and turning until it goes in.
      if (local < hit + 0.08) {
        const fall = smoothstep(0, hit, local);
        const y = lerp(-s * 0.1, surface, fall * fall);
        ctx.save();
        ctx.translate(cx, y);
        ctx.rotate(local * 3);
        ctx.fillStyle = '#4a2c18';
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.03, s * 0.045, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#2a170c';
        ctx.lineWidth = s * 0.006;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.04);
        ctx.bezierCurveTo(-s * 0.015, -s * 0.01, s * 0.015, s * 0.01, 0, s * 0.04);
        ctx.stroke();
        ctx.restore();
      }
      // The crown: droplets thrown up and out, falling back under gravity.
      if (local > hit) {
        const dt = frame.dt * slow;
        for (const drop of drops) {
          if (!drop.alive) drop.alive = true;
          if (dt > 0) {
            drop.vy += GRAVITY * s * dt;
            drop.x += drop.vx * dt;
            drop.y += drop.vy * dt;
          }
          if (drop.y > surface + s * 0.01) continue;
          ctx.fillStyle = mix(coffee, '#c58a52', 0.25);
          ctx.beginPath();
          ctx.ellipse(drop.x, drop.y, drop.r, drop.r * (1 + Math.abs(drop.vy) / (s * 3)), Math.atan2(drop.vy, drop.vx) + Math.PI / 2, 0, TAU);
          ctx.fill();
        }
        // The jet: a column rising from the centre once the crater closes.
        const jet = Math.sin(clamp((local - hit - 0.55) / 1.1) * Math.PI);
        if (jet > 0) {
          ctx.fillStyle = coffee;
          ctx.beginPath();
          ctx.ellipse(cx, surface - jet * s * 0.08, s * 0.012, jet * s * 0.1, 0, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, surface - jet * s * 0.2, s * 0.014 * jet, 0, TAU);
          ctx.fill();
        }
      }
      // A high-speed camera's readout.
      ctx.fillStyle = rgba(shade(background, -0.6), 0.6);
      ctx.font = `600 ${Math.max(9, s * 0.03)}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(24 / slow)} fps`, w * 0.05, h * 0.1);
    },
  };
}, { still: 2 });
