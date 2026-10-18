'use client';

import { rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { hash, lerp, TAU } from '../engine/math';
import { num, str } from '../types';

/**
 * #80 A constellation that drifts: points wander slowly across the frame, wrapping at its edges, and any two that come
 * near enough are joined by a line that fades with their distance.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    const colour = str(params, 'color');
    const count = num(params, 'count');
    ctx.fillStyle = str(params, 'background');
    ctx.fillRect(0, 0, w, h);
    const reach = Math.min(w, h) * 0.2;
    const points: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      const angle = hash(i, 1) * TAU;
      const speed = lerp(4, 14, hash(i, 2));
      const x = (((hash(i, 3) * w + Math.cos(angle) * speed * t) % w) + w) % w;
      const y = (((hash(i, 4) * h + Math.sin(angle) * speed * t) % h) + h) % h;
      points.push([x, y]);
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const d = Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1]);
        if (d > reach) continue;
        ctx.strokeStyle = rgba(colour, 0.35 * (1 - d / reach));
        ctx.beginPath();
        ctx.moveTo(points[i]![0], points[i]![1]);
        ctx.lineTo(points[j]![0], points[j]![1]);
        ctx.stroke();
      }
    }
    ctx.fillStyle = colour;
    points.forEach(([x, y], i) => {
      ctx.globalAlpha = 0.5 + 0.5 * hash(i, 5);
      ctx.beginPath();
      ctx.arc(x, y, lerp(1, 2.6, hash(i, 6)), 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  },
}));
