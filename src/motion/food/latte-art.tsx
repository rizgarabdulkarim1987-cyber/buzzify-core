'use client';

import { rgba, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { clamp, easeOutCubic, smoothstep, TAU } from '../engine/math';
import { str } from '../types';

const CYCLE = 8;

/** A heart in a unit box centred on the origin, pointing down. */
function heart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.55);
  ctx.bezierCurveTo(x - size * 0.95, y - size * 0.05, x - size * 0.6, y - size * 0.75, x, y - size * 0.3);
  ctx.bezierCurveTo(x + size * 0.6, y - size * 0.75, x + size * 0.95, y - size * 0.05, x, y + size * 0.55);
  ctx.fill();
}

/**
 * #51 Latte art poured into the cup, seen from above: milk breaks through the crema as a pale blob, the pitcher sways
 * to lay down the pattern (a heart, a rosetta's leaves or a tulip's stacked hearts), and a last pull through the middle
 * draws the pattern to its point. It holds, the cup is "drunk", and the pour starts again.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    const crema = str(params, 'color');
    const milk = str(params, 'accent');
    const shape = str(params, 'shape');
    ctx.fillStyle = shade(crema, -0.55);
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = s * 0.4;
    const local = t % CYCLE;
    // The saucer and the cup's rim.
    ctx.fillStyle = '#f2ece2';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.16, 0, TAU);
    ctx.fill();
    const rim = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.2, cx, cy, R * 1.08);
    rim.addColorStop(0, '#ffffff');
    rim.addColorStop(1, '#d8cfc1');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.06, 0, TAU);
    ctx.fill();
    // The crema: deep at the wall, a lighter swirl at the middle.
    const surface = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    surface.addColorStop(0, shade(crema, 0.18));
    surface.addColorStop(0.8, crema);
    surface.addColorStop(1, shade(crema, -0.35));
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    const pour = easeOutCubic(clamp((local - 0.6) / 3));
    const pull = smoothstep(3.8, 4.6, local);
    const drink = smoothstep(6.6, 7.6, local);
    ctx.globalAlpha = 1 - drink;
    ctx.fillStyle = milk;
    ctx.shadowColor = rgba(milk, 0.6);
    ctx.shadowBlur = s * 0.01;
    if (shape === 'heart') {
      heart(ctx, cx, cy - R * 0.05, R * 0.95 * pour);
    } else if (shape === 'tulip') {
      [0, 1, 2].forEach((i) => {
        const at = clamp(pour * 3 - i);
        if (at > 0) heart(ctx, cx, cy + R * (0.35 - i * 0.32), R * (0.62 - i * 0.12) * easeOutCubic(at));
      });
    } else {
      // A rosetta: leaves laid down in pairs as the pitcher sways back up the cup.
      const leaves = 7;
      for (let i = 0; i < leaves; i++) {
        const at = clamp(pour * leaves - i);
        if (at <= 0) continue;
        const y = cy + R * (0.55 - i * 0.15);
        const width = R * (0.75 - i * 0.07) * easeOutCubic(at);
        ctx.beginPath();
        ctx.ellipse(cx, y, width, R * 0.07, 0, Math.PI, TAU);
        ctx.ellipse(cx, y - R * 0.02, width * 0.82, R * 0.045, 0, TAU, Math.PI, true);
        ctx.fill();
      }
    }
    // The pull-through: a thin line of crema-coloured milk dragged down the middle, ending in the point.
    if (pull > 0) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = shade(crema, 0.1);
      ctx.lineWidth = R * 0.03;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy - R * 0.62);
      ctx.lineTo(cx, cy - R * 0.62 + R * 1.25 * pull);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
}), { still: 6 });
