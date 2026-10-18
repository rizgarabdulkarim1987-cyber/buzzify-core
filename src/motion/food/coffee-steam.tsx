'use client';

import { canvasMotion } from '../engine/define';
import { lerp, noise3, TAU } from '../engine/math';
import { num, str } from '../types';

type Ribbon = Array<[number, number]>;

/** Three passes of the same ribbons: a wide faint haze, a body, and a thin bright core. */
const PASSES = [
  [0.05, 0.09, 0.07],
  [0.02, 0.045, 0.1],
  [0.008, 0.018, 0.12],
] as const;

/**
 * #49 Steam over a cup: soft ribbons rise, widen and curl on a slow current, fading as they climb. Each ribbon is a path
 * through moving noise. The ribbons are drawn into a half-size layer that is blurred as a whole, once per pass, so the
 * softness costs three blurs a frame rather than one per stroke.
 */
export default canvasMotion(() => {
  let layer: HTMLCanvasElement | null = null;
  return {
    resize(width, height) {
      layer = document.createElement('canvas');
      layer.width = Math.max(1, Math.round(width / 2));
      layer.height = Math.max(1, Math.round(height / 2));
    },
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const strength = num(params, 'intensity');
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w, h);
      const cx = w / 2;
      const rim = h * 0.66;
      // The cup.
      const china = ctx.createLinearGradient(cx - s * 0.2, 0, cx + s * 0.2, 0);
      china.addColorStop(0, '#bdb2a1');
      china.addColorStop(0.35, '#fffdf8');
      china.addColorStop(1, '#a89c89');
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.93, s * 0.3, s * 0.05, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = china;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, rim);
      ctx.bezierCurveTo(cx - s * 0.2, rim + s * 0.26, cx + s * 0.2, rim + s * 0.26, cx + s * 0.2, rim);
      ctx.fill();
      ctx.strokeStyle = china;
      ctx.lineWidth = s * 0.03;
      ctx.beginPath();
      ctx.arc(cx + s * 0.22, rim + s * 0.08, s * 0.06, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = '#e9e1d3';
      ctx.beginPath();
      ctx.ellipse(cx, rim, s * 0.2, s * 0.035, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#4a2a17';
      ctx.beginPath();
      ctx.ellipse(cx, rim + 2, s * 0.17, s * 0.026, 0, 0, TAU);
      ctx.fill();

      const ribbons: Ribbon[] = [];
      for (let k = 0; k < 4; k++) {
        const points: Ribbon = [];
        for (let i = 0; i <= 26; i++) {
          const a = i / 26;
          const drift = (noise3(k * 3.1, a * 2.4 - t * 0.35, t * 0.1) - 0.5) * s * 0.5 * a;
          points.push([cx + lerp(-0.08, 0.08, k / 3) * s + drift, rim - a * h * 0.62]);
        }
        ribbons.push(points);
      }
      const lctx = layer?.getContext('2d');
      if (!layer || !lctx) return;
      for (const [blur, width, alpha] of PASSES) {
        lctx.setTransform(layer.width / w, 0, 0, layer.height / h, 0, 0);
        lctx.clearRect(0, 0, w, h);
        lctx.lineCap = 'round';
        for (const points of ribbons) {
          for (let i = 1; i < points.length; i++) {
            const a = i / points.length;
            lctx.strokeStyle = `rgba(255,255,255,${alpha * strength * Math.sin(Math.PI * a) * 1.6})`;
            lctx.lineWidth = s * width * (0.5 + a);
            lctx.beginPath();
            lctx.moveTo(points[i - 1]![0], points[i - 1]![1]);
            lctx.lineTo(points[i]![0], points[i]![1]);
            lctx.stroke();
          }
        }
        ctx.filter = `blur(${s * blur}px)`;
        ctx.drawImage(layer, 0, 0, w, h);
      }
      ctx.filter = 'none';
    },
  };
});
