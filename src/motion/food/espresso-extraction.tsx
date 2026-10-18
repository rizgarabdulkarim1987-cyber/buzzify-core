'use client';

import { mix, rgb, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { LiquidField, type Blob } from '../engine/liquid';
import { clamp, easeInOutCubic, smoothstep, TAU } from '../engine/math';
import { str } from '../types';

const SHOT = 8;

/**
 * #47 An espresso shot pulled into a glass: two thin streams fall from the portafilter's spouts, tiger-striped as they
 * darken and pale, the glass fills, and the crema rises on top and settles as the streams blond and stop.
 */
export default canvasMotion(() => {
  let liquid: LiquidField | null = null;
  return {
    resize(width, height) {
      liquid = new LiquidField(width, height, 2);
    },
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const crema = str(params, 'color');
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w, h);
      const local = t % SHOT;
      const flow = smoothstep(0.6, 1.4, local) * (1 - smoothstep(6, 6.8, local));
      const fill = easeInOutCubic(clamp((local - 0.9) / 5.6));
      const cx = w / 2;
      // The group head and portafilter.
      const metal = ctx.createLinearGradient(cx - s * 0.2, 0, cx + s * 0.2, 0);
      metal.addColorStop(0, '#3a3836');
      metal.addColorStop(0.45, '#c9c6c1');
      metal.addColorStop(1, '#3a3836');
      ctx.fillStyle = metal;
      ctx.fillRect(cx - s * 0.2, h * 0.08, s * 0.4, s * 0.07);
      ctx.fillRect(cx - s * 0.05, h * 0.08 + s * 0.07, s * 0.1, s * 0.04);
      ctx.fillStyle = '#1a1817';
      ctx.fillRect(cx + s * 0.2, h * 0.08 + s * 0.015, s * 0.22, s * 0.035);
      const spoutY = h * 0.08 + s * 0.11;
      const glassTop = h * 0.5;
      const glassBottom = h * 0.86;
      const glassW = s * 0.24;
      const liquidTop = glassBottom - (glassBottom - glassTop) * 0.75 * fill;
      const cremaDepth = s * 0.05 * smoothstep(0.1, 0.5, fill);
      // Inside the glass: the dark body, crema above, a soft line between.
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - glassW / 2, glassTop, glassW, glassBottom - glassTop);
      ctx.clip();
      const body = ctx.createLinearGradient(0, liquidTop, 0, glassBottom);
      body.addColorStop(0, crema);
      body.addColorStop(Math.min(0.99, cremaDepth / Math.max(1, glassBottom - liquidTop)), shade(crema, -0.45));
      body.addColorStop(1, '#1a0b05');
      ctx.fillStyle = body;
      ctx.fillRect(cx - glassW / 2, liquidTop, glassW, glassBottom - liquidTop);
      ctx.restore();
      // The two streams, shifting from dark to tiger stripes to blond.
      if (flow > 0.02 && liquid) {
        const blobs: Blob[] = [];
        const tone = mix('#3b1a0b', crema, smoothstep(2, 6, local));
        for (const side of [-1, 1]) {
          const x = cx + side * s * 0.022;
          for (let i = 0; i < 8; i++) {
            const a = i / 8;
            const b = (i + 1) / 8;
            const sway = (k: number) => Math.sin(t * 9 + k * 7 + side) * s * 0.0025 * k;
            blobs.push({ x: x + sway(a) - side * a * s * 0.006, y: spoutY + (liquidTop - spoutY) * a, x2: x + sway(b) - side * b * s * 0.006, y2: spoutY + (liquidTop - spoutY) * b, r: s * 0.0055 * flow * (1 - a * 0.25) });
          }
        }
        liquid.draw(ctx, blobs, { color: rgb(tone), gloss: 1 }, w, h);
      }
      // The glass: walls, a heavy base, highlights.
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = s * 0.008;
      ctx.strokeRect(cx - glassW / 2, glassTop, glassW, glassBottom - glassTop);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(cx - glassW / 2, glassBottom, glassW, s * 0.03);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(cx - glassW / 2 + s * 0.015, glassTop + s * 0.02, s * 0.018, glassBottom - glassTop - s * 0.04);
      ctx.beginPath();
      ctx.ellipse(cx, glassTop, glassW / 2, s * 0.012, 0, 0, TAU);
      ctx.stroke();
    },
  };
}, { still: 4 });
