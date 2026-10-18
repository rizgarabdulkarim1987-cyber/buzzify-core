'use client';

import { canvasMotion } from '../engine/define';
import { num, str } from '../types';

/** Grain changes at film speed, not screen speed: 24 new frames a second. */
const FPS = 24;

/**
 * #83 Film grain over a colour: a fine, shifting noise that gives a flat ground the texture of print or film. The grain
 * is drawn small and stretched up without smoothing, so it stays crisp at any size; a vignette deepens the corners.
 */
export default canvasMotion(() => {
  let grain: HTMLCanvasElement | null = null;
  let image: ImageData | null = null;
  let frameShown = -1;
  return {
    resize(width, height) {
      grain = document.createElement('canvas');
      grain.width = Math.max(32, Math.round(width / 2));
      grain.height = Math.max(32, Math.round(height / 2));
      image = grain.getContext('2d')!.createImageData(grain.width, grain.height);
      frameShown = -1;
    },
    draw(ctx, frame) {
      const { width: w, height: h, params } = frame;
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      if (!grain || !image) return;
      const index = Math.floor(frame.t * FPS);
      if (index !== frameShown) {
        frameShown = index;
        const data = image.data;
        let seed = (index * 2654435761) >>> 0;
        for (let i = 0; i < data.length; i += 4) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const v = seed >>> 24;
          data[i] = data[i + 1] = data[i + 2] = v;
          data[i + 3] = 255;
        }
        grain.getContext('2d')!.putImageData(image, 0, 0);
      }
      ctx.globalAlpha = num(params, 'intensity') * 0.5;
      ctx.globalCompositeOperation = 'overlay';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(grain, 0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    },
  };
});
