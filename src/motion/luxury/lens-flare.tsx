'use client';

import { rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { damp, TAU } from '../engine/math';
import { num, str } from '../types';

/** Ghosts along the line from the light through the centre: where (0 = at the light, 2 = mirrored across), size, tint. */
const GHOSTS: Array<[at: number, size: number, tint: string, hexagon: boolean]> = [
  [0.45, 0.05, '#ffd38a', false],
  [0.7, 0.025, '#9fd8ff', true],
  [1.15, 0.09, '#ffb36b', true],
  [1.4, 0.04, '#b8ffd4', false],
  [1.75, 0.14, '#c7a2ff', true],
  [2.05, 0.06, '#ffd38a', false],
];

function polygon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, sides: number) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU + Math.PI / 6;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

/**
 * #43 A bright light in the frame and the flare it throws in the lens: a hot core, a long horizontal streak, a ring,
 * and a string of coloured ghosts mirrored through the centre. The light follows the pointer; untouched, it drifts.
 */
export default canvasMotion(() => {
  const light = { x: 0.3, y: 0.3 };
  return {
    draw(ctx, frame) {
      const { width: w, height: h, params } = frame;
      const colour = str(params, 'color');
      const strength = num(params, 'intensity');
      light.x = damp(light.x, frame.pointer.x / w, 6, frame.dt || 1);
      light.y = damp(light.y, frame.pointer.y / h, 6, frame.dt || 1);
      const lx = light.x * w;
      const ly = light.y * h;
      const s = Math.min(w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const core = ctx.createRadialGradient(lx, ly, 0, lx, ly, s * 0.45);
      core.addColorStop(0, rgba('#ffffff', 1));
      core.addColorStop(0.05, rgba(colour, 0.9 * strength + 0.1));
      core.addColorStop(0.3, rgba(colour, 0.18 * strength));
      core.addColorStop(1, rgba(colour, 0));
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, w, h);
      // The anamorphic streak.
      const streak = ctx.createLinearGradient(0, 0, w, 0);
      streak.addColorStop(0, rgba(colour, 0));
      streak.addColorStop(Math.max(0, Math.min(1, light.x)), rgba('#ffe7c6', 0.65 * strength));
      streak.addColorStop(1, rgba(colour, 0));
      ctx.fillStyle = streak;
      ctx.fillRect(0, ly - s * 0.006, w, s * 0.012);
      // A thin ring around the light.
      ctx.strokeStyle = rgba(colour, 0.12 * strength);
      ctx.lineWidth = s * 0.004;
      ctx.beginPath();
      ctx.arc(lx, ly, s * 0.3, 0, TAU);
      ctx.stroke();
      const cx = w / 2;
      const cy = h / 2;
      for (const [at, size, tint, hexagon] of GHOSTS) {
        const gx = lx + (cx - lx) * at;
        const gy = ly + (cy - ly) * at;
        const r = s * size;
        const ghost = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        ghost.addColorStop(0, rgba(tint, 0.05 * strength));
        ghost.addColorStop(0.75, rgba(tint, 0.16 * strength));
        ghost.addColorStop(1, rgba(tint, 0));
        ctx.fillStyle = ghost;
        if (hexagon) polygon(ctx, gx, gy, r, 6);
        else {
          ctx.beginPath();
          ctx.arc(gx, gy, r, 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  };
});
