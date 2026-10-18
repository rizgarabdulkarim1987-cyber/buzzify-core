'use client';

import { rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { FONTS } from '../engine/fonts';
import { easeInOutCubic, hash, noise3, TAU } from '../engine/math';
import { textPoints, type Point } from '../engine/shapes';
import { str } from '../types';

/**
 * #30 Grains scattered across the page drift on a slow current; as the reader scrolls they gather into the brand's
 * word, and scatter again on the way back up. The word is drawn whole, so Arabic and Sorani letters keep their joins.
 */
export default canvasMotion(
  (params) => {
    const word = str(params, 'text');
    let targets: Point[] = [];
    let size = { width: 0, height: 0 };
    let dot = 2;
    const build = () => {
      if (!size.width) return;
      const step = Math.max(3, Math.round(Math.min(size.width, size.height) / 80));
      dot = step * 0.75;
      targets = textPoints(word, FONTS.serif!, size.width, size.height, step);
    };
    // The face may arrive after the first drawing: gather into the real letters once it has.
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
        const gather = easeInOutCubic(frame.progress);
        ctx.fillStyle = colour;
        targets.forEach(([tx, ty], i) => {
          const sx = hash(i, 1) * w;
          const sy = hash(i, 2) * h;
          const drift = noise3(sx * 0.004, sy * 0.004, t * 0.15) * TAU * 2;
          const loose = 1 - gather;
          const x = sx + Math.cos(drift) * 30 * loose + (tx - sx) * gather;
          const y = sy + Math.sin(drift) * 30 * loose + (ty - sy) * gather;
          ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2 + i));
          ctx.fillRect(x, y, dot, dot);
        });
        ctx.globalAlpha = 1;
        // A soft bloom over the gathered word.
        if (gather > 0.6) {
          const bloom = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.4);
          bloom.addColorStop(0, rgba(colour, 0.12 * (gather - 0.6) * 2.5));
          bloom.addColorStop(1, rgba(colour, 0));
          ctx.fillStyle = bloom;
          ctx.fillRect(0, 0, w, h);
        }
      },
    };
  },
  { rebuild: ['text'] },
);
