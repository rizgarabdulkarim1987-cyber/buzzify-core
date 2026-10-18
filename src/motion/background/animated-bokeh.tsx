'use client';

import { mix, rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { hash, lerp, TAU } from '../engine/math';
import { num, str } from '../types';

/** One out-of-focus light: a disc with a slightly brighter rim, as a lens draws it. */
function disc(colour: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 46);
  g.addColorStop(0, rgba(colour, 0.35));
  g.addColorStop(0.8, rgba(colour, 0.45));
  g.addColorStop(0.92, rgba(colour, 0.7));
  g.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(48, 48, 46, 0, TAU);
  ctx.fill();
  return canvas;
}

/**
 * #86 The lights of a room thrown out of focus: soft discs of warm and rose light of many sizes drift upward and sway,
 * brightening and dimming, overlapping where they meet.
 */
export default canvasMotion(() => {
  const cache = new Map<string, HTMLCanvasElement>();
  const sprite = (colour: string) => {
    let found = cache.get(colour);
    if (!found) {
      found = disc(colour);
      cache.set(colour, found);
    }
    return found;
  };
  return {
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const a = str(params, 'color');
      const b = str(params, 'accent');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const count = num(params, 'count');
      const s = Math.min(w, h);
      for (let i = 0; i < count; i++) {
        const colour = mix(a, b, Math.round(hash(i, 1) * 4) / 4);
        const size = s * lerp(0.06, 0.24, hash(i, 2) ** 1.5);
        const rise = (hash(i, 3) + t * lerp(0.01, 0.03, hash(i, 4))) % 1;
        const x = hash(i, 5) * w + Math.sin(t * 0.3 + i) * s * 0.03;
        const y = h * (1.15 - rise * 1.3);
        ctx.globalAlpha = lerp(0.35, 0.9, 0.5 + 0.5 * Math.sin(t * lerp(0.4, 1.2, hash(i, 6)) + i)) * Math.min(1, rise * 5, (1 - rise) * 5);
        ctx.drawImage(sprite(colour), x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
});
