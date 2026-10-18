'use client';

import { rgb } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { hash, lerp, noise3 } from '../engine/math';
import { num, str } from '../types';

/** A soft round glow drawn once per colour and stamped for every particle. */
function sprite(colour: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const [r, g, b] = rgb(colour);
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, `rgba(255,250,235,1)`);
  glow.addColorStop(0.18, `rgba(${r},${g},${b},0.9)`);
  glow.addColorStop(0.5, `rgba(${r},${g},${b},0.22)`);
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

/**
 * #34 Gold dust in a dark room: motes at many depths drift up on a slow current, the near ones larger and quicker, and
 * now and then one catches the light and flashes a four-point glint.
 */
export default canvasMotion(() => {
  let stamp: HTMLCanvasElement | null = null;
  let stampColour = '';
  return {
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const colour = str(params, 'color');
      if (!stamp || stampColour !== colour) {
        stamp = sprite(colour);
        stampColour = colour;
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const count = num(params, 'count');
      const s = Math.min(w, h);
      for (let i = 0; i < count; i++) {
        const depth = hash(i, 1);
        const size = lerp(0.006, 0.03, depth * depth) * s;
        const rise = (hash(i, 2) + t * lerp(0.015, 0.05, depth)) % 1;
        const sway = (noise3(i * 0.31, t * 0.12, 0) - 0.5) * 0.12;
        const x = (hash(i, 3) + sway) * w;
        const y = h * (1.05 - rise * 1.1);
        const twinkle = 0.5 + 0.5 * Math.sin(t * lerp(1, 3, hash(i, 4)) + i);
        ctx.globalAlpha = lerp(0.25, 0.9, depth) * (0.55 + 0.45 * twinkle) * Math.min(1, rise * 6, (1 - rise) * 6);
        ctx.drawImage(stamp, x - size * 2, y - size * 2, size * 4, size * 4);
        // A glint: a thin four-point star on the brightest moments of the nearest motes.
        if (depth > 0.7 && twinkle > 0.96) {
          const g = (twinkle - 0.96) / 0.04;
          ctx.globalAlpha = g * 0.9;
          ctx.strokeStyle = '#fff6df';
          ctx.lineWidth = Math.max(1, size * 0.12);
          ctx.beginPath();
          ctx.moveTo(x - size * 3, y);
          ctx.lineTo(x + size * 3, y);
          ctx.moveTo(x, y - size * 3);
          ctx.lineTo(x, y + size * 3);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
});
