import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { seeded } from './shapes';

/** Textures drawn on a canvas at load: marble veins, a waffle cone, a soft gradient. No image files are fetched. */

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')];
}

/** White marble with soft grey veins (or any base and vein colour). */
export function marbleTexture(base: string, vein: string, seed = 7): CanvasTexture {
  const [element, context] = canvas(512, 512);
  if (context) {
    const random = seeded(seed);
    context.fillStyle = base;
    context.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 14; i++) {
      context.strokeStyle = vein;
      context.globalAlpha = 0.08 + random() * 0.22;
      context.lineWidth = 0.6 + random() * 2.6;
      context.beginPath();
      let x = random() * 512;
      let y = -20;
      context.moveTo(x, y);
      while (y < 540) {
        const nx = x + (random() - 0.5) * 120;
        const ny = y + 30 + random() * 70;
        context.quadraticCurveTo(x + (random() - 0.5) * 80, (y + ny) / 2, nx, ny);
        x = nx;
        y = ny;
      }
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** The criss-cross of a waffle cone. */
export function waffleTexture(base: string, groove: string): CanvasTexture {
  const [element, context] = canvas(256, 256);
  if (context) {
    context.fillStyle = base;
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = groove;
    context.lineWidth = 7;
    for (let i = -256; i < 512; i += 42) {
      context.beginPath();
      context.moveTo(i, 0);
      context.lineTo(i + 256, 256);
      context.stroke();
      context.beginPath();
      context.moveTo(i + 256, 0);
      context.lineTo(i, 256);
      context.stroke();
    }
  }
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 2);
  return texture;
}

/** A vertical light shaft: bright at the top, gone at the bottom, soft at the sides. */
export function shaftTexture(): CanvasTexture {
  const [element, context] = canvas(64, 256);
  if (context) {
    const vertical = context.createLinearGradient(0, 0, 0, 256);
    vertical.addColorStop(0, 'rgba(255,255,255,0.9)');
    vertical.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = vertical;
    context.fillRect(0, 0, 64, 256);
    context.globalCompositeOperation = 'destination-in';
    const horizontal = context.createLinearGradient(0, 0, 64, 0);
    horizontal.addColorStop(0, 'rgba(0,0,0,0)');
    horizontal.addColorStop(0.5, 'rgba(0,0,0,1)');
    horizontal.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = horizontal;
    context.fillRect(0, 0, 64, 256);
  }
  return new CanvasTexture(element);
}

/** Fine speckle for gelato, stone and crust: a grey bump map. */
export function speckleTexture(seed = 3, density = 900): CanvasTexture {
  const [element, context] = canvas(256, 256);
  if (context) {
    const random = seeded(seed);
    context.fillStyle = '#808080';
    context.fillRect(0, 0, 256, 256);
    for (let i = 0; i < density; i++) {
      const shade = Math.round(90 + random() * 90);
      context.fillStyle = `rgb(${shade},${shade},${shade})`;
      context.beginPath();
      context.arc(random() * 256, random() * 256, 0.6 + random() * 2.2, 0, Math.PI * 2);
      context.fill();
    }
  }
  const texture = new CanvasTexture(element);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}
