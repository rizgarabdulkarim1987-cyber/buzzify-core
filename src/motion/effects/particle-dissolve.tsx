'use client';

import { canvasMotion } from '../engine/define';
import { FONTS } from '../engine/fonts';
import { clamp, easeInCubic, easeOutCubic, hash, noise3, TAU } from '../engine/math';
import { textPoints, type Point } from '../engine/shapes';
import { str } from '../types';

const CYCLE = 6;

/**
 * #136 A word that turns to dust and back: it stands whole, then crumbles from its first letter to its last, each grain
 * lifting away on a drifting current and fading; after a breath the grains stream back and the word stands again.
 */
export default canvasMotion(
  (params) => {
    const word = str(params, 'text');
    let points: Point[] = [];
    let size = { width: 0, height: 0 };
    let span = { min: 0, max: 1 };
    let dot = 2;
    const build = () => {
      if (!size.width) return;
      const step = Math.max(2, Math.round(Math.min(size.width, size.height) / 110));
      dot = step * 0.9;
      points = textPoints(word, FONTS.serif!, size.width, size.height, step, 0.4);
      const xs = points.map(([x]) => x);
      span = { min: Math.min(...xs, 0), max: Math.max(...xs, 1) };
    };
    if (typeof document !== 'undefined') void document.fonts?.load(`600 48px ${FONTS.serif}`, word).then(build, build);
    return {
      resize(width, height) {
        size = { width, height };
        build();
      },
      draw(ctx, frame) {
        const { width: w, height: h, t, params: live } = frame;
        const colour = str(live, 'color');
        ctx.fillStyle = str(live, 'background');
        ctx.fillRect(0, 0, w, h);
        const local = t % CYCLE;
        ctx.fillStyle = colour;
        for (let i = 0; i < points.length; i++) {
          const [x, y] = points[i]!;
          // Each grain leaves when the sweep reaches it, and returns in the same order.
          const order = (x - span.min) / Math.max(1, span.max - span.min);
          const leave = clamp((local - 1.2 - order * 1.1) / 1.4);
          const back = clamp((local - 4.1 - order * 0.6) / 1.1);
          const away = easeInCubic(leave) * (1 - easeOutCubic(back));
          if (away > 0.98) continue;
          const angle = noise3(x * 0.01, y * 0.01, t * 0.2) * TAU * 2 - Math.PI / 2;
          const reach = Math.min(w, h) * (0.25 + hash(i, 1) * 0.35) * away;
          const gx = x + Math.cos(angle) * reach + away * w * 0.08;
          const gy = y + Math.sin(angle) * reach - away * h * 0.1;
          ctx.globalAlpha = 1 - away;
          ctx.fillRect(gx, gy, dot * (1 - away * 0.5), dot * (1 - away * 0.5));
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  { rebuild: ['text'], still: 0.6 },
);
