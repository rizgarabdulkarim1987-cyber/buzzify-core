'use client';

import { rgb } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { fbm, hash, lerp, TAU } from '../engine/math';
import { num, str } from '../types';

const PUFFS = 22;

/** A wisp of smoke: noise masked by a soft circle, drawn once per colour. */
function puff(colour: string): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const [r, g, b] = rgb(colour);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5;
      const dy = y / size - 0.5;
      const fall = Math.max(0, 1 - Math.hypot(dx, dy) * 2);
      const density = fbm(x * 0.05, y * 0.05, 3.7, 4);
      const alpha = fall * fall * Math.max(0, density - 0.3) * 1.8;
      const k = (y * size + x) * 4;
      image.data[k] = r;
      image.data[k + 1] = g;
      image.data[k + 2] = b;
      image.data[k + 3] = Math.min(255, alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * #85 Smoke drifting slowly across the frame, as over a grill or from a snuffed candle: many soft wisps rise and drift
 * sideways, each turning and spreading as it goes and thinning to nothing.
 */
export default canvasMotion(() => {
  let sprite: HTMLCanvasElement | null = null;
  let spriteColour = '';
  return {
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const colour = str(params, 'color');
      if (!sprite || colour !== spriteColour) {
        sprite = puff(colour);
        spriteColour = colour;
      }
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      const strength = num(params, 'intensity');
      const s = Math.max(w, h);
      for (let i = 0; i < PUFFS; i++) {
        const life = (hash(i, 1) + t * lerp(0.025, 0.05, hash(i, 2))) % 1;
        const x = lerp(-0.1, 1.1, hash(i, 3)) * w + Math.sin(life * TAU + i) * w * 0.05 + life * w * 0.15;
        const y = h * (1.1 - life * 1.3);
        const size = s * lerp(0.25, 0.6, life) * lerp(0.7, 1.2, hash(i, 4));
        ctx.save();
        ctx.globalAlpha = strength * 0.55 * Math.sin(Math.PI * life);
        ctx.translate(x, y);
        ctx.rotate(hash(i, 5) * TAU + life * 1.2);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    },
  };
});
