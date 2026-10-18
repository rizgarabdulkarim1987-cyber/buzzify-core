'use client';

import { rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { noise3 } from '../engine/math';
import { num, str } from '../types';

/**
 * #87 Lines of moving water drawn like a contour map: many thin lines one above another, each lifted by the same slow
 * swell and its own ripples, so the field reads as one rolling surface seen from the side.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    const colour = str(params, 'color');
    const lines = num(params, 'count');
    ctx.fillStyle = str(params, 'background');
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0025);
    for (let i = 0; i < lines; i++) {
      const k = i / Math.max(1, lines - 1);
      const base = h * (0.15 + k * 0.75);
      ctx.strokeStyle = rgba(colour, 0.25 + 0.6 * k);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 5) {
        const u = x / w;
        const swell = Math.sin(u * 5 + t * 0.6 + k * 2.2) * h * 0.04;
        const ripple = (noise3(u * 3, k * 2, t * 0.25) - 0.5) * h * 0.12 * (0.4 + k);
        const y = base + swell + ripple;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
}));
