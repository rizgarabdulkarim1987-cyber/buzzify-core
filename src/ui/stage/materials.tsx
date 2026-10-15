'use client';

import { CanvasTexture, Color, DoubleSide, SRGBColorSpace } from 'three';
import { drinkStyle, type LayerKind } from '@/lib/stage';

/**
 * Surface of the drink: a body colour, a lighter crema ring at the wall and a soft swirl; milk
 * drinks and matcha get a poured heart on top. Drawn once per mount on a canvas.
 */
export function cremaTexture(tone: string): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const base = new Color(tone);
    const light = base.clone().lerp(new Color('#f6e7c8'), 0.6);
    const dark = base.clone().multiplyScalar(0.62);
    const hex = (color: Color) => '#' + color.getHexString();
    context.fillStyle = hex(dark);
    context.fillRect(0, 0, size, size);
    const body = context.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
    body.addColorStop(0, hex(base));
    body.addColorStop(0.68, hex(base.clone().multiplyScalar(0.94)));
    body.addColorStop(0.9, hex(light));
    body.addColorStop(1, hex(dark));
    context.fillStyle = body;
    context.fillRect(0, 0, size, size);

    // Crema swirl.
    context.strokeStyle = 'rgba(' + [light.r, light.g, light.b].map((v) => Math.round(Math.min(1, v) * 255)).join(',') + ',0.42)';
    context.lineWidth = 12;
    context.lineCap = 'round';
    context.beginPath();
    for (let i = 0; i <= 220; i++) {
      const angle = i * 0.11;
      const radius = 8 + i * 0.95;
      const x = size / 2 + Math.cos(angle) * radius;
      const y = size / 2 + Math.sin(angle) * radius;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();

    if (drinkStyle(tone) === 'art') {
      context.save();
      context.translate(size / 2, size / 2 + 8);
      context.shadowColor = 'rgba(250,240,220,0.7)';
      context.shadowBlur = 16;
      const heart = (scale: number, fill: string) => {
        context.beginPath();
        context.moveTo(0, 96 * scale);
        context.bezierCurveTo(-140 * scale, 6 * scale, -128 * scale, -100 * scale, 0, -44 * scale);
        context.bezierCurveTo(128 * scale, -100 * scale, 140 * scale, 6 * scale, 0, 96 * scale);
        context.closePath();
        context.fillStyle = fill;
        context.fill();
      };
      heart(1, 'rgba(250,240,222,0.94)');
      context.shadowBlur = 0;
      heart(0.74, hex(base.clone().lerp(light, 0.22)));
      heart(0.5, 'rgba(250,240,222,0.9)');
      heart(0.28, hex(base.clone().lerp(light, 0.22)));
      context.restore();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function shadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(0,0,0,0.7)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.26)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

/** A soft round dot for particles: steam, bubbles and dust. */
export function softDotTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
}

/** Layers that are see-through are drawn last and do not cast shadows. */
export function isTransparentKind(kind: LayerKind): boolean {
  return kind === 'glass' || kind === 'liquid' || kind === 'ice';
}

export function renderOrderOf(kind: LayerKind): number {
  if (kind === 'liquid') return 2;
  if (kind === 'ice') return 3;
  if (kind === 'glass') return 4;
  return 0;
}

export function LayerMaterial({
  kind,
  tone,
  crema,
}: {
  kind: LayerKind;
  tone: string;
  crema: CanvasTexture | null;
}) {
  switch (kind) {
    case 'saucer':
    case 'cup':
      return (
        <meshPhysicalMaterial
          vertexColors
          roughness={0.09}
          clearcoat={1}
          clearcoatRoughness={0.04}
          envMapIntensity={1.15}
        />
      );
    case 'coffee':
      return <meshPhysicalMaterial map={crema ?? undefined} roughness={0.12} clearcoat={0.7} clearcoatRoughness={0.1} />;
    case 'glass':
      return (
        <meshPhysicalMaterial
          color="#eef6fb"
          transparent
          opacity={0.2}
          roughness={0.02}
          metalness={0}
          envMapIntensity={2.2}
          depthWrite={false}
          side={DoubleSide}
        />
      );
    case 'liquid':
      return (
        <meshPhysicalMaterial
          color={tone}
          transparent
          opacity={0.9}
          roughness={0.06}
          clearcoat={0.4}
          envMapIntensity={1.1}
          depthWrite={false}
        />
      );
    case 'ice':
      return (
        <meshPhysicalMaterial
          vertexColors
          transparent
          opacity={0.55}
          roughness={0.12}
          envMapIntensity={1.8}
          depthWrite={false}
        />
      );
    case 'lemon':
      return <meshStandardMaterial vertexColors roughness={0.42} side={DoubleSide} />;
    case 'croissant':
      return <meshPhysicalMaterial vertexColors roughness={0.5} clearcoat={0.35} clearcoatRoughness={0.45} envMapIntensity={0.9} />;
    case 'puff-1':
    case 'puff-2':
    case 'puff-3':
      return <meshStandardMaterial vertexColors roughness={0.62} envMapIntensity={0.8} />;
    case 'cream-1':
    case 'cream-2':
      return <meshPhysicalMaterial vertexColors roughness={0.42} sheen={0.6} sheenColor="#fff4d6" envMapIntensity={0.9} />;
    case 'icing':
      return <meshPhysicalMaterial vertexColors roughness={0.26} clearcoat={0.6} clearcoatRoughness={0.25} />;
    case 'bun-top':
      return <meshPhysicalMaterial vertexColors roughness={0.42} clearcoat={0.18} clearcoatRoughness={0.5} envMapIntensity={0.95} />;
    case 'bun-bottom':
      return <meshStandardMaterial vertexColors roughness={0.6} envMapIntensity={0.85} />;
    case 'patty':
    case 'patty-2':
      return <meshStandardMaterial vertexColors roughness={0.72} envMapIntensity={0.7} />;
    case 'cheese':
      return (
        <meshPhysicalMaterial
          vertexColors
          roughness={0.28}
          clearcoat={0.85}
          clearcoatRoughness={0.2}
          sheen={0.5}
          sheenColor="#ffd36b"
          side={DoubleSide}
        />
      );
    case 'lettuce':
      return <meshStandardMaterial vertexColors roughness={0.46} side={DoubleSide} envMapIntensity={0.9} />;
    case 'tomato':
      return <meshPhysicalMaterial vertexColors roughness={0.22} clearcoat={0.7} clearcoatRoughness={0.18} />;
    case 'pickles':
      return <meshPhysicalMaterial vertexColors roughness={0.28} clearcoat={0.5} clearcoatRoughness={0.2} />;
    case 'bacon':
      return <meshStandardMaterial vertexColors roughness={0.45} side={DoubleSide} />;
  }
}
