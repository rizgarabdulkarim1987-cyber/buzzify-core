'use client';

import { canvasMotion } from '../engine/define';
import { lerp } from '../engine/math';
import { num, str } from '../types';

/** The flame's colours from cold to hot: soot, ember red, orange, yellow, white. */
const RAMP: Array<[number, number, number]> = [
  [0, 0, 0],
  [40, 6, 2],
  [110, 18, 4],
  [190, 50, 8],
  [235, 110, 20],
  [250, 170, 40],
  [255, 220, 110],
  [255, 250, 220],
];

function palette(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const at = (i / 255) * (RAMP.length - 1);
    const k = Math.floor(at);
    const f = at - k;
    const a = RAMP[k]!;
    const b = RAMP[Math.min(RAMP.length - 1, k + 1)]!;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = lerp(a[c]!, b[c]!, f);
  }
  return out;
}

/**
 * #139 Grill flames that lick upward: a cellular fire, where every cell takes the heat of the one below it, loses a
 * little and drifts sideways at random, so tongues of flame rise, break and flicker from a hot bed of coals.
 */
export default canvasMotion(() => {
  const colours = palette();
  let heat: Float32Array | null = null;
  let nx = 0;
  let ny = 0;
  let image: ImageData | null = null;
  let layer: HTMLCanvasElement | null = null;
  let accumulator = 0;
  return {
    resize(width, height) {
      nx = Math.max(40, Math.round(width / 4));
      ny = Math.max(30, Math.round(height / 4));
      heat = new Float32Array(nx * ny);
      layer = document.createElement('canvas');
      layer.width = nx;
      layer.height = ny;
      image = layer.getContext('2d')!.createImageData(nx, ny);
    },
    draw(ctx, frame) {
      if (!heat || !image || !layer) return;
      const strength = num(frame.params, 'intensity');
      accumulator += frame.dt === 0 ? 1 / 30 : frame.dt;
      // The fire updates at 40 steps a second whatever the screen's rate.
      while (accumulator > 1 / 40) {
        accumulator -= 1 / 40;
        for (let x = 0; x < nx; x++) heat[(ny - 1) * nx + x] = Math.random() < 0.7 ? 1 : 0.6;
        const decay = lerp(0.075, 0.03, strength) * (60 / ny);
        for (let y = 0; y < ny - 1; y++) {
          for (let x = 0; x < nx; x++) {
            const below = heat[(y + 1) * nx + x]!;
            const drift = Math.floor(Math.random() * 3) - 1;
            const target = y * nx + Math.min(nx - 1, Math.max(0, x + drift));
            heat[target] = Math.max(0, below - Math.random() * decay);
          }
        }
      }
      const data = image.data;
      for (let i = 0; i < nx * ny; i++) {
        const level = Math.min(255, Math.floor(heat[i]! * 255));
        data[i * 4] = colours[level * 3]!;
        data[i * 4 + 1] = colours[level * 3 + 1]!;
        data[i * 4 + 2] = colours[level * 3 + 2]!;
        data[i * 4 + 3] = level < 6 ? 0 : 255;
      }
      layer.getContext('2d')!.putImageData(image, 0, 0);
      ctx.fillStyle = str(frame.params, 'background');
      ctx.fillRect(0, 0, frame.width, frame.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(layer, 0, 0, frame.width, frame.height);
      // The grill's bars across the coals.
      ctx.fillStyle = '#1b1715';
      for (let i = 0; i < 9; i++) ctx.fillRect((i / 9) * frame.width + frame.width * 0.02, frame.height * 0.9, frame.width * 0.07, frame.height * 0.1);
    },
  };
}, { still: 2 });
