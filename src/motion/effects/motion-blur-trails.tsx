'use client';

import { rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { hash, lerp, TAU } from '../engine/math';
import { num, str } from '../types';

const SAMPLES = 18;

/**
 * #145 Lights moving fast enough to smear: each orb sweeps round its own ellipse, and its trail is the orb drawn again
 * at the places it has just been, fainter and thinner the further back, as a long camera exposure would show it.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    const colour = str(params, 'color');
    const count = num(params, 'count');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = str(params, 'background');
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const s = Math.min(w, h);
    for (let i = 0; i < count; i++) {
      const speed = lerp(1.2, 2.4, hash(i, 1)) * (i % 2 === 0 ? 1 : -1);
      const rx = s * lerp(0.18, 0.42, hash(i, 2));
      const ry = s * lerp(0.08, 0.28, hash(i, 3));
      const tilt = hash(i, 4) * Math.PI;
      const size = s * lerp(0.012, 0.024, hash(i, 5));
      const position = (time: number): [number, number] => {
        const a = time * speed + hash(i, 6) * TAU;
        const x = Math.cos(a) * rx;
        const y = Math.sin(a) * ry;
        return [w / 2 + x * Math.cos(tilt) - y * Math.sin(tilt), h / 2 + x * Math.sin(tilt) + y * Math.cos(tilt)];
      };
      for (let k = SAMPLES; k >= 0; k--) {
        const [x, y] = position(t - k * 0.018);
        const fade = 1 - k / (SAMPLES + 1);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 3 * fade + 1);
        glow.addColorStop(0, rgba(k === 0 ? '#fff6e0' : colour, 0.55 * fade * fade));
        glow.addColorStop(1, rgba(colour, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, size * 3 * fade + 1, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  },
}));
