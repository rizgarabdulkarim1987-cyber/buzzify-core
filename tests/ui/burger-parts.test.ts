import { Box3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { burgerLayers, type LayerKind } from '@/lib/stage';
import { domeHeight, makeLayerGeometry } from '@/ui/stage/burger-parts';

const ALL: LayerKind[] = ['bun-bottom', 'lettuce', 'tomato', 'patty', 'patty-2', 'bacon', 'cheese', 'pickles', 'bun-top'];

function box(geometry: BufferGeometry): Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

const radius = (b: Box3) => Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z);

describe('burger geometry', () => {
  it('builds finite, non-empty geometry for every layer kind', () => {
    for (const kind of ALL) {
      const position = makeLayerGeometry(kind).getAttribute('position');
      expect(position.count, kind).toBeGreaterThan(0);
      for (let i = 0; i < position.array.length; i++) expect(Number.isFinite(position.array[i]), kind).toBe(true);
    }
  });

  it('keeps the core of every geometry inside the height the layer model gives it', () => {
    // The core is everything within 0.9 of the axis. A draped slice of cheese hangs further out, where
    // nothing else is stacked, so only its core has to fit the layer.
    const heights = new Map(burgerLayers({ cheese: true, patty: true, bacon: true }).map((l) => [l.key, l.height]));
    for (const kind of ALL) {
      const position = makeLayerGeometry(kind).getAttribute('position');
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < position.count; i++) {
        if (Math.hypot(position.getX(i), position.getZ(i)) > 0.9) continue;
        low = Math.min(low, position.getY(i));
        high = Math.max(high, position.getY(i));
      }
      expect(high - low, kind).toBeLessThanOrEqual(heights.get(kind)! + 0.04);
      // The cheese core is a flat slab; its thickness is drawn by the material, not the mesh.
      if (kind !== 'cheese') expect(high - low, kind).toBeGreaterThan(0.03);
    }
  });

  it('centres each geometry on its own origin so a layer can be placed by its centre', () => {
    for (const kind of ['bun-bottom', 'bun-top', 'patty', 'tomato'] as const) {
      const b = box(makeLayerGeometry(kind));
      expect((b.max.y + b.min.y) / 2, kind).toBeCloseTo(0, 1);
    }
  });

  it('sizes the bun and patty so the patty is slightly wider than the bun', () => {
    const bun = radius(box(makeLayerGeometry('bun-bottom')));
    const patty = radius(box(makeLayerGeometry('patty')));
    expect(bun).toBeGreaterThan(0.97);
    expect(bun).toBeLessThan(1.03);
    expect(patty).toBeGreaterThan(1.0);
    expect(patty).toBeLessThan(1.1);
  });

  it('drapes the cheese over the patty edge', () => {
    const b = box(makeLayerGeometry('cheese'));
    expect(b.min.y).toBeLessThan(-0.1);
    expect(radius(b)).toBeGreaterThanOrEqual(1.0);
  });

  it('keeps the toppings inside the bun', () => {
    for (const kind of ['lettuce', 'tomato', 'pickles', 'bacon'] as const) {
      expect(radius(box(makeLayerGeometry(kind))), kind).toBeLessThanOrEqual(1.15);
    }
  });

  it('describes the bun dome as a falling curve from its crown', () => {
    expect(domeHeight(0)).toBeCloseTo(0.52, 2);
    let last = Infinity;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const h = domeHeight(r);
      expect(h).toBeLessThanOrEqual(last + 1e-9);
      last = h;
    }
    expect(domeHeight(1)).toBeGreaterThan(0.05);
  });
});
