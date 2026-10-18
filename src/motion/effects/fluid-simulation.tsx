'use client';

import { rgb } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { FluidGrid } from '../engine/fluid';
import { str } from '../types';

const CELLS = 96;

/**
 * #137 A real fluid simulation: drag through it and the pointer pushes the fluid and pours coloured dye into it, which
 * swirls, folds into eddies and slowly fades. Without a pointer, two slow currents stir it from the sides.
 */
export default canvasMotion(
  () => {
    let grid: FluidGrid | null = null;
    let image: ImageData | null = null;
    let layer: HTMLCanvasElement | null = null;
    let last: { x: number; y: number } | null = null;
    return {
      resize(width, height) {
        const nx = width >= height ? CELLS : Math.round((CELLS * width) / height);
        const ny = width >= height ? Math.round((CELLS * height) / width) : CELLS;
        grid = new FluidGrid(Math.max(16, nx), Math.max(16, ny));
        layer = document.createElement('canvas');
        layer.width = grid.nx;
        layer.height = grid.ny;
        image = layer.getContext('2d')!.createImageData(grid.nx, grid.ny);
        last = null;
      },
      draw(ctx, frame) {
        if (!grid || !image || !layer) return;
        const { width: w, height: h, t, pointer, params } = frame;
        const dt = Math.min(frame.dt, 1 / 30);
        const gx = (pointer.x / w) * grid.nx + 1;
        const gy = (pointer.y / h) * grid.ny + 1;
        if (pointer.inside) {
          if (last && dt > 0) grid.splat(gx, gy, ((gx - last.x) / grid.nx / dt) * 0.6, ((gy - last.y) / grid.ny / dt) * 0.6, 2, 0.6, 6);
          last = { x: gx, y: gy };
        } else {
          last = null;
          if (dt > 0) {
            // Two slow currents, from the left and from the right, swaying.
            grid.splat(5, grid.ny * (0.5 + 0.3 * Math.sin(t * 0.7)), 0.9, Math.cos(t * 0.9) * 0.4, 1.6, 0, 6);
            grid.splat(grid.nx - 4, grid.ny * (0.5 + 0.3 * Math.cos(t * 0.6)), -0.9, Math.sin(t * 0.8) * 0.4, 0, 1.6, 6);
          }
        }
        grid.step(dt, { fade: 0.55, friction: 0.7 });
        const [ar, ag, ab] = rgb(str(params, 'color'));
        const [br, bg, bb] = rgb(str(params, 'accent'));
        const [kr, kg, kb] = rgb(str(params, 'background'));
        const data = image.data;
        for (let j = 0; j < grid.ny; j++) {
          for (let i = 0; i < grid.nx; i++) {
            const k = grid.index(i + 1, j + 1);
            const a = Math.min(1, grid.dyeA[k]!);
            const b = Math.min(1, grid.dyeB[k]!);
            const o = (j * grid.nx + i) * 4;
            data[o] = Math.min(255, kr * (1 - a - b * 0.5) + ar * a + br * b);
            data[o + 1] = Math.min(255, kg * (1 - a - b * 0.5) + ag * a + bg * b);
            data[o + 2] = Math.min(255, kb * (1 - a - b * 0.5) + ab * a + bb * b);
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
  { touchAction: 'none', still: 4 },
);
