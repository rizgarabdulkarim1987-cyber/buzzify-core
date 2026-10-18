'use client';

import { rgb, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { hash } from '../engine/math';
import { num, str } from '../types';

/** The pool's floor: tiles in the water's colour, which the ripples bend. */
function floor(colour: string, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = shade(colour, -0.35);
  ctx.fillRect(0, 0, width, height);
  const tile = Math.max(8, Math.round(Math.min(width, height) / 7));
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      ctx.fillStyle = shade(colour, ((x / tile + y / tile) % 2 === 0 ? 0.08 : -0.1) + (hash(x, y) - 0.5) * 0.06);
      ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
    }
  }
  return ctx.getImageData(0, 0, width, height);
}

/**
 * #140 Water over a tiled floor: touches (or raindrops, when nobody touches) set off rings that spread, cross and fade,
 * and the floor beneath is bent by the slope of the surface and lit along the crests. A two-buffer wave equation.
 */
export default canvasMotion(() => {
  let nx = 0;
  let ny = 0;
  let current: Float32Array | null = null;
  let previous: Float32Array | null = null;
  let bed: ImageData | null = null;
  let bedColour = '';
  let output: ImageData | null = null;
  let layer: HTMLCanvasElement | null = null;
  let nextDrop = 0;
  let drops = 0;
  let pending: Array<[number, number]> = [];
  let size = { width: 1, height: 1 };
  const drop = (x: number, y: number, power: number) => {
    if (!current) return;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const px = Math.round(x) + i;
        const py = Math.round(y) + j;
        if (px > 0 && px < nx - 1 && py > 0 && py < ny - 1) current[py * nx + px] = power * Math.exp(-(i * i + j * j) / 2);
      }
    }
  };
  return {
    resize(width, height) {
      size = { width, height };
      nx = Math.max(60, Math.round(width / 3));
      ny = Math.max(40, Math.round(height / 3));
      current = new Float32Array(nx * ny);
      previous = new Float32Array(nx * ny);
      layer = document.createElement('canvas');
      layer.width = nx;
      layer.height = ny;
      output = layer.getContext('2d')!.createImageData(nx, ny);
      bed = null;
    },
    pointerDown(x, y) {
      pending.push([(x / size.width) * nx, (y / size.height) * ny]);
    },
    draw(ctx, frame) {
      if (!current || !previous || !output || !layer) return;
      const colour = str(frame.params, 'color');
      if (!bed || bedColour !== colour) {
        bed = floor(colour, nx, ny);
        bedColour = colour;
      }
      const strength = num(frame.params, 'intensity');
      if (frame.pointer.inside && frame.dt > 0) drop((frame.pointer.x / frame.width) * nx, (frame.pointer.y / frame.height) * ny, 120 * strength);
      for (const [x, y] of pending) drop(x, y, 400 * strength);
      pending = [];
      if (!frame.pointer.inside && frame.t >= nextDrop) {
        drop(hash(drops, 1) * nx, hash(drops, 2) * ny, 320 * strength);
        drops += 1;
        nextDrop = frame.t + 0.5 + hash(drops, 3) * 0.8;
      }
      // One step of the wave equation per frame: each cell moves toward the average of its neighbours, and damps.
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const k = y * nx + x;
          previous[k] = ((current[k - 1]! + current[k + 1]! + current[k - nx]! + current[k + nx]!) / 2 - previous[k]!) * 0.975;
        }
      }
      [current, previous] = [previous, current];
      const source = bed.data;
      const out = output.data;
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const k = y * nx + x;
          const dx = current[k + 1]! - current[k - 1]!;
          const dy = current[k + nx]! - current[k - nx]!;
          const sx = Math.min(nx - 1, Math.max(0, x + Math.round(dx * 0.04)));
          const sy = Math.min(ny - 1, Math.max(0, y + Math.round(dy * 0.04)));
          const s = (sy * nx + sx) * 4;
          const light = Math.max(0, -dx - dy) * 0.25;
          out[k * 4] = Math.min(255, source[s]! + light);
          out[k * 4 + 1] = Math.min(255, source[s + 1]! + light);
          out[k * 4 + 2] = Math.min(255, source[s + 2]! + light);
          out[k * 4 + 3] = 255;
        }
      }
      layer.getContext('2d')!.putImageData(output, 0, 0);
      const [r, g, b] = rgb(colour);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, frame.width, frame.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(layer, 1, 1, nx - 2, ny - 2, 0, 0, frame.width, frame.height);
    },
  };
}, { still: 3 });
