'use client';

import { rgba, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { clamp, hash, lerp, TAU } from '../engine/math';
import { str } from '../types';

const CYCLE = 5;

/** A lemon wheel: rind, pith, and the segments seen edge-on as the slice turns. */
function lemon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(turn * 1.3)));
  ctx.fillStyle = '#f2c230';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff6cf';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f7dc58';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.78, (i / 8) * TAU + 0.06, ((i + 1) / 8) * TAU - 0.06);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * #59 A lemon slice dropped into a tall glass: it plunges, the surface throws up a crown of droplets that arc and fall
 * back, a wave runs across the drink, and a trail of bubbles rises behind the slice as it bobs back up.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    const drink = str(params, 'color');
    ctx.fillStyle = str(params, 'background');
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    const cx = w / 2;
    const glassW = s * 0.34;
    const glassTop = h * 0.2;
    const glassBottom = h * 0.9;
    const surface = h * 0.42;
    const local = t % CYCLE;
    const impact = 0.7;
    const since = local - impact;
    const wave = since > 0 ? Math.exp(-since * 1.6) : 0;
    // The drink, with a wave running across after the slice goes in.
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - glassW / 2, glassTop, glassW, glassBottom - glassTop);
    ctx.clip();
    const body = ctx.createLinearGradient(0, surface, 0, glassBottom);
    body.addColorStop(0, shade(drink, 0.25));
    body.addColorStop(1, shade(drink, -0.25));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(cx - glassW, glassBottom);
    for (let x = -glassW / 2; x <= glassW / 2; x += 2) ctx.lineTo(cx + x, surface + Math.sin(x * 0.09 - since * 9) * s * 0.018 * wave);
    ctx.lineTo(cx + glassW, glassBottom);
    ctx.fill();
    // Bubbles rising along the slice's path.
    for (let i = 0; i < 26; i++) {
      const life = (local * 0.55 + hash(i, 1)) % 1;
      const by = lerp(glassBottom - s * 0.02, surface + s * 0.02, life);
      const bx = cx + (hash(i, 2) - 0.5) * glassW * 0.8 + Math.sin(life * 12 + i) * s * 0.006;
      ctx.strokeStyle = rgba('#ffffff', 0.55 * (1 - life));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bx, by, s * (0.004 + hash(i, 3) * 0.006), 0, TAU);
      ctx.stroke();
    }
    // The slice: falling, plunging, bobbing back to float.
    let ly: number;
    if (local < impact) ly = lerp(-s * 0.2, surface, (local / impact) ** 2);
    else ly = surface + Math.sin(clamp(since / 1.6) * Math.PI) * s * 0.22 * Math.exp(-since * 0.6);
    lemon(ctx, cx + s * 0.02, ly, s * 0.07, local * 2.2);
    ctx.restore();
    if (local < impact) lemon(ctx, cx + s * 0.02, ly, s * 0.07, local * 2.2);
    // The crown of droplets above the surface.
    if (since > 0 && since < 1.6) {
      for (let i = 0; i < 18; i++) {
        const a = Math.PI * (0.1 + 0.8 * hash(i, 4));
        const v = s * lerp(0.6, 1.2, hash(i, 5));
        const k = since;
        const x = cx + Math.cos(a) * v * 0.45 * k;
        const y = surface - Math.sin(a) * v * k + s * 2.2 * k * k;
        if (y > surface) continue;
        ctx.fillStyle = rgba(shade(drink, 0.35), 0.9);
        ctx.beginPath();
        ctx.arc(x, y, s * lerp(0.004, 0.009, hash(i, 6)), 0, TAU);
        ctx.fill();
      }
    }
    // The glass.
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = s * 0.008;
    ctx.beginPath();
    ctx.moveTo(cx - glassW / 2, glassTop);
    ctx.lineTo(cx - glassW / 2, glassBottom);
    ctx.lineTo(cx + glassW / 2, glassBottom);
    ctx.lineTo(cx + glassW / 2, glassTop);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(cx - glassW / 2 + s * 0.02, glassTop + s * 0.02, s * 0.02, glassBottom - glassTop - s * 0.04);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(cx - glassW / 2, glassBottom, glassW, s * 0.025);
  },
}), { still: 1.1 });
