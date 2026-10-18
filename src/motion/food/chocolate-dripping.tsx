'use client';

import { rgb } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { LiquidField, type Blob } from '../engine/liquid';
import { hash, lerp, smoothstep } from '../engine/math';
import { str } from '../types';

const DRIPS = 9;

/**
 * #52 Chocolate poured over the top of the frame runs down in drips: each gathers at the edge, stretches into a neck,
 * swells at its tip and falls away, then a new one gathers. Glossy, joined liquid with a highlight along each drip.
 */
export default canvasMotion(() => {
  let liquid: LiquidField | null = null;
  return {
    resize(width, height) {
      liquid = new LiquidField(width, height, 2.5);
    },
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      if (!liquid) return;
      const s = Math.min(w, h);
      const edge = h * 0.2;
      const blobs: Blob[] = [];
      // The sheet of chocolate across the top, gently rippling.
      for (let i = 0; i <= 14; i++) {
        const x = (i / 14) * w;
        blobs.push({ x, y: -s * 0.05, x2: x, y2: edge + Math.sin(i * 1.7 + t) * s * 0.012, r: s * 0.05 });
      }
      for (let i = 0; i < DRIPS; i++) {
        const x = lerp(0.06, 0.94, (i + hash(i, 1) * 0.6) / DRIPS) * w;
        const period = lerp(3.2, 5.4, hash(i, 2));
        const phase = ((t + hash(i, 3) * period) % period) / period;
        // Each drip: grows from the edge, stretches, its tip falls free at the end of its period.
        const grow = smoothstep(0, 0.7, phase);
        const length = lerp(0.02, lerp(0.35, 0.62, hash(i, 4)), grow) * h;
        const tip = edge + length;
        const width = s * lerp(0.016, 0.026, hash(i, 5));
        blobs.push({ x, y: edge, x2: x, y2: tip - width, r: width * (1 - grow * 0.45) });
        blobs.push({ x, y: tip, r: width * (1 + grow * 0.35) });
        if (phase > 0.72) {
          const fall = (phase - 0.72) / 0.28;
          blobs.push({ x, y: tip + fall * fall * h * 0.8, r: width * 1.2 });
        }
      }
      liquid.draw(ctx, blobs, { color: rgb(str(params, 'color')), gloss: 1 }, w, h);
    },
  };
}, { still: 3 });
