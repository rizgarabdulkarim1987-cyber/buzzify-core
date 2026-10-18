'use client';

import { mix, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { str } from '../types';

const LAYERS = 4;

/**
 * #79 Glossy liquid rolling across the bottom of the frame in layers: each layer is a long wave moving at its own speed,
 * darker toward the front, with a bright line of light along its crest like the edge of poured caramel.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    const front = str(params, 'accent');
    const back = str(params, 'color');
    ctx.fillStyle = str(params, 'background');
    ctx.fillRect(0, 0, w, h);
    for (let layer = 0; layer < LAYERS; layer++) {
      const k = layer / (LAYERS - 1);
      const base = h * (0.42 + k * 0.16);
      const amplitude = h * (0.05 + k * 0.025);
      const speed = 0.25 + k * 0.2;
      const colour = mix(back, front, k);
      const y = (x: number) =>
        base + Math.sin(x / w * Math.PI * 2 * (1.2 + k * 0.4) + t * speed + layer * 1.7) * amplitude + Math.sin(x / w * Math.PI * 2 * 3.1 - t * speed * 1.4 + layer) * amplitude * 0.3;
      const body = ctx.createLinearGradient(0, base - amplitude, 0, h);
      body.addColorStop(0, shade(colour, 0.12));
      body.addColorStop(1, shade(colour, -0.3));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) ctx.lineTo(x, y(x));
      ctx.lineTo(w, h);
      ctx.fill();
      // The crest's highlight.
      ctx.strokeStyle = `rgba(255,255,255,${0.35 - k * 0.06})`;
      ctx.lineWidth = Math.max(1.2, h * 0.004);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        if (x === 0) ctx.moveTo(x, y(x) + 2);
        else ctx.lineTo(x, y(x) + 2);
      }
      ctx.stroke();
    }
  },
}));
