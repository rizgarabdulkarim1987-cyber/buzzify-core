'use client';

import { rgb, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { LiquidField, type Blob } from '../engine/liquid';
import { smoothstep, TAU } from '../engine/math';
import { str } from '../types';

const CYCLE = 9;

/**
 * #53 Honey from a wooden dipper: a slow, thick ribbon falls, swaying a little, and coils on itself where it lands,
 * folding into a growing golden mound. The stream thins, breaks, and the dipper drips again.
 */
export default canvasMotion(() => {
  let liquid: LiquidField | null = null;
  return {
    resize(width, height) {
      liquid = new LiquidField(width, height, 2.5);
    },
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const honey = str(params, 'color');
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w, h);
      const cx = w / 2;
      const local = t % CYCLE;
      const dipperY = h * 0.2;
      const ground = h * 0.86;
      // The dipper: a handle and a grooved head.
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(cx - s * 0.5, dipperY - s * 0.015, s * 0.4, s * 0.03);
      const wood = ctx.createLinearGradient(0, dipperY - s * 0.06, 0, dipperY + s * 0.06);
      wood.addColorStop(0, '#c48a4d');
      wood.addColorStop(1, '#7a4a20');
      ctx.fillStyle = wood;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(cx - s * 0.08 + i * s * 0.04, dipperY, s * 0.022, s * 0.06 - Math.abs(i - 2) * s * 0.008, 0, 0, TAU);
        ctx.fill();
      }
      if (!liquid) return;
      const flow = smoothstep(0.3, 1, local) * (1 - smoothstep(6.6, 7.6, local));
      const pile = smoothstep(1, 7, local) * (1 - smoothstep(8.2, 9, local));
      const blobs: Blob[] = [];
      const coat = smoothstep(0, 0.6, local);
      blobs.push({ x: cx - s * 0.09, y: dipperY + s * 0.04, x2: cx + s * 0.09, y2: dipperY + s * 0.04, r: s * 0.025 * coat });
      const top = ground - s * 0.05 - pile * s * 0.08;
      if (flow > 0.02) {
        for (let i = 0; i < 12; i++) {
          const a = i / 12;
          const b = (i + 1) / 12;
          const x = (k: number) => cx + Math.sin(t * 1.3 + k * 3) * s * 0.012 * k;
          const y = (k: number) => dipperY + s * 0.06 + (top - dipperY - s * 0.06) * k;
          blobs.push({ x: x(a), y: y(a), x2: x(b), y2: y(b), r: s * 0.009 * flow * (1 - a * 0.3) });
        }
      }
      // The coil: honey folding back and forth on the mound, sliding outward as the mound grows.
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + t * 1.6;
        const rad = s * (0.02 + (i / 16) * 0.12) * (0.4 + pile);
        blobs.push({ x: cx + Math.cos(a) * rad, y: ground - s * 0.03 - pile * s * 0.06 * (1 - i / 16) + Math.sin(a) * rad * 0.25, r: s * 0.022 * (0.3 + pile) });
      }
      blobs.push({ x: cx - s * 0.18 * (0.3 + pile), y: ground, x2: cx + s * 0.18 * (0.3 + pile), y2: ground, r: s * 0.02 * (0.2 + pile) });
      liquid.draw(ctx, blobs, { color: rgb(shade(honey, 0.05)), gloss: 1, clarity: 0.7 }, w, h);
    },
  };
}, { still: 4.5 });
