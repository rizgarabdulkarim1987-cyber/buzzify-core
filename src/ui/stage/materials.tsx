'use client';

import { useEffect, useMemo } from 'react';
import { CanvasTexture, Color, DoubleSide, SRGBColorSpace } from 'three';
import { drinkStyle, type LayerKind } from '@/lib/stage';
import { BADGE, BAG, BAG_PRINT, CHILI, CHIP, FLAME, FOIL, SEASONING, STEM, roundedTriangle, type PrintShape } from './stage-parts';

const css = (color: Color) => '#' + color.getHexString();

/**
 * The printed foil of the chip bag. The right half of the canvas is the front face and the left half the back,
 * each laid out flat across the face as the bag's UVs expect, at the same scale across and up so shapes stay true.
 */
export function bagPrintTexture(): CanvasTexture {
  const width = 2048;
  const height = Math.round(((width / 4) * BAG.height) / BAG.halfWidth);
  const dot = width / 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) {
    const scale = width / 4 / BAG.halfWidth;
    // Foil: a deep blue with soft vertical sheen bands.
    const sheen = context.createLinearGradient(0, 0, width, 0);
    for (let i = 0; i <= 8; i++) {
      const light = i % 2 === 0 ? 0.18 : -0.12;
      sheen.addColorStop(i / 8, css(FOIL.clone().lerp(new Color(light > 0 ? '#6f8dff' : '#0b1a66'), Math.abs(light))));
    }
    context.fillStyle = sheen;
    context.fillRect(0, 0, width, height);
    // The crimped seam along the bottom.
    context.fillStyle = 'rgba(255,255,255,0.12)';
    for (let x = 0; x < width; x += 3 * dot) context.fillRect(x, height * 0.955, 1.5 * dot, height * 0.045);
    // A lighter band where the top was torn open, showing the foil's silver inside edge.
    const lip = context.createLinearGradient(0, 0, 0, height * 0.05);
    lip.addColorStop(0, 'rgba(220,228,255,0.55)');
    lip.addColorStop(1, 'rgba(220,228,255,0)');
    context.fillStyle = lip;
    context.fillRect(0, 0, width, height * 0.05);

    const draw = (shapes: PrintShape[], centre: number) => {
      const px = (x: number) => centre + x * scale;
      const py = (y: number) => height - y * scale;
      for (const shape of shapes) {
        if (shape.kind === 'chili') {
          context.save();
          context.translate(px(shape.x), py(shape.y));
          context.rotate(-shape.turn);
          const half = (shape.length * scale) / 2;
          context.fillStyle = css(CHILI);
          context.beginPath();
          context.moveTo(-half, 0);
          context.quadraticCurveTo(-half * 0.2, -0.05 * scale, half, -0.03 * scale);
          context.quadraticCurveTo(-half * 0.1, 0.06 * scale, -half, 0);
          context.fill();
          context.strokeStyle = css(STEM);
          context.lineWidth = 0.02 * scale;
          context.lineCap = 'round';
          context.beginPath();
          context.moveTo(-half, 0);
          context.lineTo(-half - 0.04 * scale, -0.015 * scale);
          context.stroke();
          context.restore();
          continue;
        }
        const turn = shape.kind === 'badge' ? -Math.PI / 2 : shape.turn;
        context.beginPath();
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          const r = shape.r * roundedTriangle(a, turn);
          const x = px(shape.x + Math.cos(a) * r);
          const y = py(shape.y + Math.sin(a) * r);
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        if (shape.kind === 'badge') {
          context.fillStyle = css(BADGE);
          context.fill();
          context.strokeStyle = css(FLAME);
          context.lineWidth = 0.03 * scale;
          context.stroke();
          // A white chevron through the badge.
          context.strokeStyle = '#f7f3ea';
          context.lineWidth = 0.035 * scale;
          context.lineJoin = 'round';
          context.beginPath();
          context.moveTo(px(shape.x - shape.r * 0.5), py(shape.y + shape.r * 0.18));
          context.lineTo(px(shape.x - shape.r * 0.05), py(shape.y - shape.r * 0.55));
          context.lineTo(px(shape.x + shape.r * 0.62), py(shape.y + shape.r * 0.32));
          context.stroke();
          continue;
        }
        const fill = context.createRadialGradient(px(shape.x), py(shape.y), 1, px(shape.x), py(shape.y), shape.r * scale);
        fill.addColorStop(0, '#f7b54c');
        fill.addColorStop(1, css(CHIP));
        context.fillStyle = fill;
        context.fill();
        // Seasoning dust, clipped to the chip.
        context.save();
        context.clip();
        context.fillStyle = css(SEASONING);
        for (let i = 0; i < 700; i++) {
          const a = Math.sin(i * 12.9898 + shape.r * 78.233) * 43758.5453;
          const b = Math.sin(i * 39.3468 + shape.turn * 11.135) * 24634.6345;
          const x = px(shape.x + ((a - Math.floor(a)) * 2 - 1) * shape.r);
          const y = py(shape.y + ((b - Math.floor(b)) * 2 - 1) * shape.r);
          context.globalAlpha = 0.35 + 0.5 * (a - Math.floor(a));
          context.fillRect(x, y, dot * (1 + (i % 3) * 0.5), dot);
        }
        // Small bubbles, lighter than the chip.
        context.fillStyle = '#ffd27a';
        for (let i = 0; i < 90; i++) {
          const a = Math.sin(i * 7.233 + shape.r * 31.7) * 15731.743;
          const b = Math.sin(i * 3.917 + shape.turn * 5.31) * 27183.281;
          context.globalAlpha = 0.25;
          context.beginPath();
          context.arc(
            px(shape.x + ((a - Math.floor(a)) * 2 - 1) * shape.r * 0.8),
            py(shape.y + ((b - Math.floor(b)) * 2 - 1) * shape.r * 0.8),
            dot * (1.5 + 2 * (b - Math.floor(b))),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
        context.restore();
        // The chip's edge, toasted darker.
        context.strokeStyle = 'rgba(150,60,20,0.55)';
        context.lineWidth = 0.008 * scale;
        context.stroke();
      }
    };
    draw(BAG_PRINT.front, width * 0.75);
    draw(BAG_PRINT.back, width * 0.25);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Glossy printed foil. The print texture is drawn once per bag on the screen. */
function BagMaterial() {
  const print = useMemo(() => bagPrintTexture(), []);
  useEffect(() => () => print.dispose(), [print]);
  return (
    <meshPhysicalMaterial
      map={print}
      metalness={0.35}
      roughness={0.3}
      clearcoat={0.8}
      clearcoatRoughness={0.16}
      envMapIntensity={1.25}
      side={DoubleSide}
    />
  );
}

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
    case 'bag':
      return <BagMaterial />;
    case 'chips':
      return <meshStandardMaterial vertexColors roughness={0.6} side={DoubleSide} envMapIntensity={0.85} />;
    case 'chicken':
      return <meshPhysicalMaterial vertexColors roughness={0.5} clearcoat={0.25} clearcoatRoughness={0.4} />;
    case 'beef':
      return <meshPhysicalMaterial vertexColors roughness={0.55} clearcoat={0.35} clearcoatRoughness={0.35} />;
    case 'veg':
      return <meshPhysicalMaterial vertexColors roughness={0.32} clearcoat={0.5} clearcoatRoughness={0.25} side={DoubleSide} />;
    case 'jalapeno':
      return <meshPhysicalMaterial vertexColors roughness={0.24} clearcoat={0.7} clearcoatRoughness={0.15} />;
    case 'sauce':
      return (
        <meshPhysicalMaterial
          vertexColors
          roughness={0.24}
          clearcoat={0.9}
          clearcoatRoughness={0.15}
          sheen={0.5}
          sheenColor="#ffd36b"
        />
      );
  }
}
