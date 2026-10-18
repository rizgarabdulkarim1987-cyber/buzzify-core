'use client';

import { rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { easeInOutCubic, smoothstep } from '../engine/math';
import { beanOutline, cupOutline, heartOutline, resample, type Point } from '../engine/shapes';
import { bool, str } from '../types';

const POINTS = 360;

/**
 * #27 One line that becomes three things as the page scrolls: a coffee bean, then a cup, then a heart. Each outline is
 * resampled to the same number of points from the same starting place, so the line flows from one to the next. The
 * bean's seam fades as it turns into the cup.
 */
export default canvasMotion(() => {
  const shapes = [resample(beanOutline(), POINTS), resample(cupOutline(), POINTS), resample(heartOutline(), POINTS)];
  const point: Point = [0, 0];
  const at = (p: number, i: number): Point => {
    const span = p * (shapes.length - 1);
    const k = Math.min(shapes.length - 2, Math.floor(span));
    const t = easeInOutCubic(span - k);
    const a = shapes[k]![i]!;
    const b = shapes[k + 1]![i]!;
    point[0] = a[0] + (b[0] - a[0]) * t;
    point[1] = a[1] + (b[1] - a[1]) * t;
    return point;
  };
  return {
    draw(ctx, frame) {
      const { width, height, progress, params } = frame;
      const colour = str(params, 'color');
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width, height) * 0.3;
      const cx = width / 2;
      const cy = height / 2;
      ctx.beginPath();
      for (let i = 0; i < POINTS; i++) {
        const [x, y] = at(progress, i);
        if (i === 0) ctx.moveTo(cx + x * scale, cy + y * scale);
        else ctx.lineTo(cx + x * scale, cy + y * scale);
      }
      ctx.closePath();
      ctx.shadowColor = rgba(colour, 0.65);
      ctx.shadowBlur = scale * 0.12;
      if (bool(params, 'fill')) {
        ctx.fillStyle = rgba(colour, 0.9);
        ctx.fill();
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1.5, scale * 0.025);
      ctx.lineJoin = 'round';
      ctx.stroke();
      // The bean's seam: an S down its middle, gone by the time it is a cup.
      const seam = 1 - smoothstep(0.05, 0.3, progress);
      if (seam > 0) {
        ctx.globalAlpha = seam;
        ctx.beginPath();
        ctx.moveTo(cx, cy - scale * 0.8);
        ctx.bezierCurveTo(cx - scale * 0.32, cy - scale * 0.25, cx + scale * 0.32, cy + scale * 0.25, cx, cy + scale * 0.8);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 0;
    },
  };
});
