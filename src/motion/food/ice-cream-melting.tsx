'use client';

import { rgb, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { LiquidField, type Blob } from '../engine/liquid';
import { hash, lerp, smoothstep, TAU } from '../engine/math';
import { str } from '../types';

const CYCLE = 10;

/** A waffle cone: a tapering triangle crossed by its grid. */
function cone(ctx: CanvasRenderingContext2D, cx: number, top: number, width: number, height: number) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, top);
  ctx.lineTo(cx + width / 2, top);
  ctx.lineTo(cx, top + height);
  ctx.closePath();
  const bake = ctx.createLinearGradient(cx - width / 2, 0, cx + width / 2, 0);
  bake.addColorStop(0, '#b97a36');
  bake.addColorStop(0.45, '#e2a75d');
  bake.addColorStop(1, '#9c6227');
  ctx.fillStyle = bake;
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(110,60,20,0.55)';
  ctx.lineWidth = width * 0.025;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * width * 0.16, top);
    ctx.lineTo(cx + i * width * 0.16 + height * 0.6, top + height);
    ctx.moveTo(cx + i * width * 0.16, top);
    ctx.lineTo(cx + i * width * 0.16 - height * 0.6, top + height);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * #54 A scoop of ice cream on a warm day: it softens and slumps, drips gather at its rim and run down the cone, and a
 * pool spreads at the foot. A fresh scoop arrives and the melt begins again.
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
      const cx = w / 2;
      const local = t % CYCLE;
      const melt = smoothstep(0.8, 8.5, local);
      const arrive = smoothstep(0, 0.6, local);
      const coneTop = h * 0.5;
      const coneW = s * 0.34;
      const coneH = s * 0.42;
      cone(ctx, cx, coneTop, coneW, coneH);
      const scoopR = s * 0.16;
      const scoopY = coneTop - scoopR * 0.55 + melt * scoopR * 0.25 - (1 - arrive) * h * 0.6;
      const blobs: Blob[] = [
        { x: cx, y: scoopY, r: scoopR * (1 - melt * 0.12) },
        { x: cx - scoopR * 0.6, y: scoopY + scoopR * 0.5, x2: cx + scoopR * 0.6, y2: scoopY + scoopR * 0.5, r: scoopR * (0.45 + melt * 0.18) },
      ];
      for (let i = 0; i < 5; i++) {
        const side = lerp(-0.85, 0.85, i / 4);
        const start = coneTop + s * 0.01;
        const reach = smoothstep(hash(i, 1) * 0.4, 0.4 + hash(i, 1) * 0.5, melt) * coneH * lerp(0.2, 0.55, hash(i, 2));
        // Drips run down the cone's slope, toward its point.
        const x0 = cx + side * coneW * 0.48;
        const x1 = x0 - side * (reach / coneH) * coneW * 0.5;
        const r = s * lerp(0.008, 0.012, hash(i, 3));
        blobs.push({ x: x0, y: start, x2: x1, y2: start + reach, r });
        blobs.push({ x: x1, y: start + reach, r: r * 1.35 });
      }
      const pool = smoothstep(0.55, 1, melt);
      if (pool > 0) blobs.push({ x: cx - s * 0.12 * pool, y: coneTop + coneH + s * 0.02, x2: cx + s * 0.12 * pool, y2: coneTop + coneH + s * 0.02, r: s * 0.018 * pool });
      liquid.draw(ctx, blobs, { color: rgb(shade(str(params, 'color'), 0.05)), gloss: 0.55 }, w, h);
      // A few flecks in the scoop: it is a flavour, not paint.
      ctx.fillStyle = 'rgba(120,30,50,0.45)';
      for (let i = 0; i < 9; i++) {
        const a = hash(i, 4) * TAU;
        const d = Math.sqrt(hash(i, 5)) * scoopR * 0.75;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, scoopY + Math.sin(a) * d * 0.8, s * 0.006, 0, TAU);
        ctx.fill();
      }
    },
  };
}, { still: 6 });
