import { describe, expect, it } from 'vitest';
import { burgerLayers, cupLayers, glassLayers, NO_EXTRAS } from '@/lib/stage';
import { sampleDish } from '@/ui/explore/grains';

function bounds(values: Float32Array) {
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (let i = 0; i < values.length; i += 3) {
    const y = values[i + 1]!;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    maxR = Math.max(maxR, Math.hypot(values[i]!, values[i + 2]!));
  }
  return { minY, maxY, maxR };
}

describe('sampleDish', () => {
  it('returns exactly the requested number of grains with position, normal, colour and alpha', () => {
    const cloud = sampleDish('burger', burgerLayers(NO_EXTRAS), '#a5662f', 4000);
    expect(cloud.count).toBe(4000);
    expect(cloud.positions.length).toBe(12000);
    expect(cloud.normals.length).toBe(12000);
    expect(cloud.colors.length).toBe(12000);
    expect(cloud.alphas.length).toBe(4000);
  });

  it('produces finite positions, unit normals and colours in range', () => {
    const cloud = sampleDish('cup', cupLayers(), '#8a6a4b', 3000);
    let bad = 0;
    for (let i = 0; i < cloud.positions.length; i++) if (!Number.isFinite(cloud.positions[i])) bad++;
    expect(bad).toBe(0);
    for (let i = 0; i < cloud.count; i += 37) {
      const length = Math.hypot(cloud.normals[i * 3]!, cloud.normals[i * 3 + 1]!, cloud.normals[i * 3 + 2]!);
      expect(length).toBeCloseTo(1, 2);
    }
    let low = Infinity;
    let high = -Infinity;
    for (const value of cloud.colors) {
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1.5);
  });

  it('is deterministic, so the same dish always melts the same way', () => {
    const a = sampleDish('burger', burgerLayers(NO_EXTRAS), '#a5662f', 2000);
    const b = sampleDish('burger', burgerLayers(NO_EXTRAS), '#a5662f', 2000);
    for (let i = 0; i < a.positions.length; i += 101) expect(a.positions[i]).toBe(b.positions[i]);
  });

  it('fills the shape of the dish: on the plinth, as tall as the stack, as wide as the bun', () => {
    const layers = burgerLayers(NO_EXTRAS);
    const top = layers[layers.length - 1]!;
    const { minY, maxY, maxR } = bounds(sampleDish('burger', layers, '#a5662f', 6000).positions);
    expect(minY).toBeGreaterThan(-0.05);
    expect(maxY).toBeLessThan(top.y + top.height / 2 + 0.05);
    expect(maxY).toBeGreaterThan(top.y);
    expect(maxR).toBeGreaterThan(0.95);
    expect(maxR).toBeLessThan(1.6);
  });

  it('grows taller when a second patty is chosen', () => {
    const plain = bounds(sampleDish('burger', burgerLayers(NO_EXTRAS), '#a5662f', 3000).positions);
    const double = bounds(
      sampleDish('burger', burgerLayers({ cheese: false, patty: true, bacon: false }), '#a5662f', 3000).positions,
    );
    expect(double.maxY).toBeGreaterThan(plain.maxY + 0.15);
  });

  it('keeps the glass faint so the drink inside shows through', () => {
    const cloud = sampleDish('glass', glassLayers(), '#e8d96a', 4000);
    let faint = 0;
    let solid = 0;
    for (const alpha of cloud.alphas) {
      if (alpha < 0.5) faint++;
      else solid++;
    }
    expect(faint).toBeGreaterThan(0);
    expect(solid).toBeGreaterThan(faint);
  });
});
