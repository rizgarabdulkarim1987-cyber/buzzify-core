'use client';

import { rgb, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { LiquidField, type Blob } from '../engine/liquid';
import { clamp, hash, smoothstep } from '../engine/math';
import { str } from '../types';

const CYCLE = 3.4;

/**
 * #50 A drop of milk lands in coffee and throws up a crown: a ring of milk lifts at the impact, its rim breaks into
 * beads that fly off and fall back, and the crown sinks into the surface. Milk is drawn as glossy, joined liquid.
 */
export default canvasMotion(() => {
  let liquid: LiquidField | null = null;
  return {
    resize(width, height) {
      liquid = new LiquidField(width, height, 2.5);
    },
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const milk = str(params, 'color');
      const coffee = str(params, 'background');
      ctx.fillStyle = shade(coffee, 0.12);
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w, h);
      const local = t % CYCLE;
      const surface = h * 0.68;
      const cx = w / 2;
      // The coffee's surface, seen at a low angle.
      const pool = ctx.createLinearGradient(0, surface, 0, h);
      pool.addColorStop(0, shade(coffee, 0.2));
      pool.addColorStop(1, shade(coffee, -0.35));
      ctx.fillStyle = pool;
      ctx.fillRect(0, surface, w, h - surface);
      if (!liquid) return;
      const blobs: Blob[] = [];
      const impact = 0.55;
      if (local < impact) {
        const y = surface * (local / impact) ** 2;
        blobs.push({ x: cx, y, r: s * 0.05 }, { x: cx, y: y - s * 0.055, r: s * 0.03 });
      } else {
        const k = local - impact;
        const rise = Math.sin(clamp(k / 1.1) * Math.PI);
        const spread = s * (0.08 + clamp(k / 1.4) * 0.24);
        const crown = 22;
        // The crown's wall: a ring of blobs seen edge-on, taller toward the middle of the burst.
        for (let i = 0; i < crown; i++) {
          const a = (i / crown) * Math.PI * 2;
          const x = cx + Math.cos(a) * spread;
          const depth = Math.sin(a) * spread * 0.22;
          const height = rise * s * (0.2 + 0.08 * hash(i, 1));
          blobs.push({ x, y: surface + depth, x2: x, y2: surface + depth - height, r: s * 0.018 });
          // A bead thrown from each point of the rim.
          const fly = clamp((k - 0.35) / 1.4);
          if (fly > 0 && hash(i, 2) > 0.35) {
            const out = spread + fly * s * 0.12 * hash(i, 3);
            blobs.push({ x: cx + Math.cos(a) * out, y: surface + depth - height - fly * s * 0.22 + fly * fly * s * 0.36, r: s * 0.013 * (1 - fly * 0.4) });
          }
        }
        // The pool of milk the crown leaves, spreading and thinning.
        blobs.push({ x: cx - spread * 0.8, y: surface + s * 0.01, x2: cx + spread * 0.8, y2: surface + s * 0.01, r: s * 0.014 * (1 - smoothstep(1.6, CYCLE - impact, k)) });
      }
      liquid.draw(ctx, blobs, { color: rgb(milk), gloss: 0.8 }, w, h);
    },
  };
}, { still: 1.5 });
