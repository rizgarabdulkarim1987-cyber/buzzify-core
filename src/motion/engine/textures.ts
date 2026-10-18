import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/** A texture drawn with the 2D canvas API: posters, cards and patterns for 3D and shader motions. */
export function drawnTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, repeat = false): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  return texture;
}

/**
 * A menu poster for shader motions to bend and refract: a warm plate on a deep ground, gold rings, a few garnishes and
 * a wordmark, drawn rather than photographed so it needs no file.
 */
export function posterTexture(accent: string, word = 'Buzzify'): CanvasTexture {
  return drawnTexture(1024, 1024, (ctx, w, h) => {
    const ground = ctx.createLinearGradient(0, 0, w, h);
    ground.addColorStop(0, '#24170f');
    ground.addColorStop(1, '#0d0907');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
    // Stripes of the tablecloth.
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = accent;
    for (let x = -h; x < w; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 26, 0);
      ctx.lineTo(x + 26 + h, h);
      ctx.lineTo(x + h, h);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The plate.
    const cx = w / 2;
    const cy = h * 0.46;
    const plate = ctx.createRadialGradient(cx - 50, cy - 60, 30, cx, cy, 260);
    plate.addColorStop(0, '#fffaf0');
    plate.addColorStop(0.75, '#e9dcc5');
    plate.addColorStop(1, '#b9a481');
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.arc(cx, cy, 235, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, 205, 0, Math.PI * 2);
    ctx.stroke();
    // The dish on it: a glossy dome with highlights.
    const food = ctx.createRadialGradient(cx - 50, cy - 60, 10, cx, cy, 190);
    food.addColorStop(0, '#f3b25c');
    food.addColorStop(0.6, '#b8621f');
    food.addColorStop(1, '#5b2a0e');
    ctx.fillStyle = food;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 145, 125, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx - 70, cy - 70, 60, 26, -0.6, 0, Math.PI * 2);
    ctx.fill();
    // Herbs.
    ctx.fillStyle = '#6f8f3a';
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * 95, cy + Math.sin(a) * 76, 14, 6, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = accent;
    ctx.font = '600 92px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, cx, h * 0.8);
  });
}
