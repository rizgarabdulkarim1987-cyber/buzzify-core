'use client';

import { rgb } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { FluidGrid } from '../engine/fluid';
import { hash } from '../engine/math';
import { str } from '../types';

const CELLS = 90;

/**
 * #138 Smoke rising from a source below, simulated rather than drawn: warm smoke is buoyant, so it lifts, rolls into
 * curls as it climbs and thins away, the same fluid solver as the dye simulation with lift added.
 */
export default canvasMotion(
  () => {
    let grid: FluidGrid | null = null;
    let image: ImageData | null = null;
    let layer: HTMLCanvasElement | null = null;
    return {
      resize(width, height) {
        const nx = width >= height ? CELLS : Math.round((CELLS * width) / height);
        const ny = width >= height ? Math.round((CELLS * height) / width) : CELLS;
        grid = new FluidGrid(Math.max(16, nx), Math.max(16, ny));
        layer = document.createElement('canvas');
        layer.width = grid.nx;
        layer.height = grid.ny;
        image = layer.getContext('2d')!.createImageData(grid.nx, grid.ny);
      },
      draw(ctx, frame) {
        if (!grid || !image || !layer) return;
        const { width: w, height: h, t, params } = frame;
        const dt = Math.min(frame.dt, 1 / 30);
        if (dt > 0) {
          const wobble = Math.sin(t * 1.3) * 0.08 + (hash(Math.floor(t * 10), 1) - 0.5) * 0.06;
          grid.splat(grid.nx * (0.5 + Math.sin(t * 0.4) * 0.06), grid.ny - 3, wobble, -0.9, 2.2, 0, 5);
        }
        grid.step(dt, { fade: 0.62, buoyancy: 1.4, friction: 0.85 });
        const [sr, sg, sb] = rgb(str(params, 'color'));
        const [kr, kg, kb] = rgb(str(params, 'background'));
        const data = image.data;
        for (let j = 0; j < grid.ny; j++) {
          for (let i = 0; i < grid.nx; i++) {
            const k = grid.index(i + 1, j + 1);
            const d = Math.min(1, grid.dyeA[k]! * 0.9);
            const o = (j * grid.nx + i) * 4;
            data[o] = kr + (sr - kr) * d;
            data[o + 1] = kg + (sg - kg) * d;
            data[o + 2] = kb + (sb - kb) * d;
            data[o + 3] = 255;
          }
        }
        layer.getContext('2d')!.putImageData(image, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(layer, 0, 0, w, h);
      },
    };
  },
  { still: 4 },
);
