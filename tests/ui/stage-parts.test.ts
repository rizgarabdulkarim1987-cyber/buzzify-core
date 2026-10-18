import { Box3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  bagLayers,
  burgerLayers,
  croissantLayers,
  cupLayers,
  glassLayers,
  millefeuilleLayers,
  type LayerKind,
} from '@/lib/stage';
import {
  CUP_RIM,
  SAUCER_RIM,
  domeHeight,
  makeLayerGeometry,
  makeSesame,
} from '@/ui/stage/stage-parts';

const ALL: LayerKind[] = [
  'bun-bottom',
  'lettuce',
  'tomato',
  'patty',
  'patty-2',
  'bacon',
  'cheese',
  'pickles',
  'bun-top',
  'saucer',
  'cup',
  'coffee',
  'glass',
  'liquid',
  'ice',
  'lemon',
  'croissant',
  'puff-1',
  'cream-1',
  'puff-2',
  'cream-2',
  'puff-3',
  'icing',
  'bag',
  'chips',
  'chicken',
  'beef',
  'veg',
  'jalapeno',
  'sauce',
];

function box(geometry: BufferGeometry): Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

const radius = (b: Box3) => Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z);

describe('stage geometry', () => {
  it('builds finite, non-empty geometry for every layer kind', () => {
    for (const kind of ALL) {
      const position = makeLayerGeometry(kind).getAttribute('position');
      expect(position.count, kind).toBeGreaterThan(0);
      let broken = 0;
      for (let i = 0; i < position.array.length; i++) if (!Number.isFinite(position.array[i])) broken++;
      expect(broken, kind).toBe(0);
    }
  });

  it('keeps the core of every geometry inside the height the layer model gives it', () => {
    // The core is everything within 0.9 of the axis. A draped slice of cheese hangs further out, where
    // nothing else is stacked, so only its core has to fit the layer.
    const heights = new Map(
      [
        ...burgerLayers({ cheese: true, patty: true, bacon: true }),
        ...cupLayers(),
        ...glassLayers(),
        ...croissantLayers(),
        ...millefeuilleLayers(),
        ...bagLayers('chicken'),
        ...bagLayers('beef'),
      ].map((l) => [l.key, l.height]),
    );
    for (const kind of ALL) {
      const position = makeLayerGeometry(kind).getAttribute('position');
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < position.count; i++) {
        if (Math.hypot(position.getX(i), position.getZ(i)) > 0.9) continue;
        low = Math.min(low, position.getY(i));
        high = Math.max(high, position.getY(i));
      }
      // A lemon wheel hangs on the rim at an angle, so like the cheese drape it is not bound by its layer.
      if (kind !== 'lemon') expect(high - low, kind).toBeLessThanOrEqual(heights.get(kind)! + 0.04);
      // The cheese core is a flat slab; its thickness is drawn by the material, not the mesh.
      if (kind !== 'cheese' && kind !== 'coffee' && kind !== 'liquid') {
        expect(high - low, kind).toBeGreaterThan(0.03);
      }
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

  it('makes a cup that is hollow, with a handle, sitting inside a wider saucer', () => {
    const cup = makeLayerGeometry('cup');
    const position = cup.getAttribute('position');
    // Hollow: on the side without the handle, a slice at mid-height crosses an outer wall and an inner wall.
    const mid = box(cup);
    const midY = (mid.max.y + mid.min.y) / 2;
    const radii: number[] = [];
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getY(i) - midY) < 0.06 && Math.abs(position.getZ(i)) < 0.05 && position.getX(i) < 0) {
        radii.push(-position.getX(i));
      }
    }
    expect(radii.length).toBeGreaterThan(1);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.03);
    expect(radius(box(cup))).toBeGreaterThan(0.8); // the handle reaches past the rim
    expect(radius(box(makeLayerGeometry('saucer')))).toBeGreaterThan(0.95);
    expect(radius(box(makeLayerGeometry('coffee')))).toBeLessThan(0.7);
  });

  it('paints every part with vertex colours in a sane range', () => {
    for (const kind of ALL) {
      const geometry = makeLayerGeometry(kind);
      const color = geometry.getAttribute('color');
      expect(color, kind).toBeDefined();
      expect(color.count, kind).toBe(geometry.getAttribute('position').count);
      // One assertion per part: asserting per vertex would be tens of thousands of expectations.
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < color.array.length; i++) {
        const value = color.array[i]!;
        if (value < low) low = value;
        if (value > high) high = value;
      }
      expect(low, kind).toBeGreaterThanOrEqual(0);
      expect(high, kind).toBeLessThanOrEqual(1.5);
    }
  });

  it('builds the same shape every time', () => {
    for (const kind of ALL) {
      const a = makeLayerGeometry(kind).getAttribute('position');
      const b = makeLayerGeometry(kind).getAttribute('position');
      expect(a.count, kind).toBe(b.count);
      for (let i = 0; i < a.array.length; i += 97) expect(a.array[i], kind).toBe(b.array[i]);
    }
  });

  it('gives the buns the colour of the product', () => {
    const mean = (hex: string) => {
      const color = makeLayerGeometry('bun-top', { tone: hex }).getAttribute('color');
      let red = 0;
      for (let i = 0; i < color.count; i++) red += color.getX(i);
      return red / color.count;
    };
    expect(mean('#C98B4A')).toBeGreaterThan(mean('#5A3A20'));
  });

  it('has a sesame seed small enough to scatter by the dozen', () => {
    const b = box(makeSesame());
    expect(Math.max(b.max.x - b.min.x, b.max.z - b.min.z)).toBeLessThan(0.16);
    expect(b.max.y - b.min.y).toBeLessThan(0.08);
  });

  it('tells the scene where the gilded rims sit', () => {
    const cup = box(makeLayerGeometry('cup'));
    expect(CUP_RIM.y).toBeCloseTo(cup.max.y, 1);
    expect(CUP_RIM.radius).toBeGreaterThan(0.68);
    expect(CUP_RIM.radius).toBeLessThan(0.8);
    const saucer = box(makeLayerGeometry('saucer'));
    expect(SAUCER_RIM.y).toBeCloseTo(saucer.max.y, 1);
    expect(SAUCER_RIM.radius).toBeGreaterThan(0.95);
  });

  it('builds a tall hollow glass with the drink inside it', () => {
    const glass = box(makeLayerGeometry('glass'));
    expect(glass.max.y - glass.min.y).toBeGreaterThan(1.0);
    expect(radius(glass)).toBeLessThan(0.6);
    const liquid = box(makeLayerGeometry('liquid'));
    expect(radius(liquid)).toBeLessThan(radius(glass));
    expect(liquid.max.y - liquid.min.y).toBeLessThan(glass.max.y - glass.min.y);
  });

  it('builds a crescent croissant, wider than it is deep', () => {
    const b = box(makeLayerGeometry('croissant'));
    expect(b.max.x - b.min.x).toBeGreaterThan(1.3);
    expect(b.max.x - b.min.x).toBeGreaterThan(b.max.z - b.min.z);
    expect(b.max.y - b.min.y).toBeLessThan(0.56);
  });

  it('builds the mille-feuille as flat rectangular slabs of the same footprint', () => {
    const puff = box(makeLayerGeometry('puff-1'));
    const icing = box(makeLayerGeometry('icing'));
    expect(puff.max.x - puff.min.x).toBeCloseTo(1.7, 1);
    expect(puff.max.z - puff.min.z).toBeCloseTo(0.62, 1);
    expect(icing.max.x - icing.min.x).toBeCloseTo(puff.max.x - puff.min.x, 1);
  });

  it('builds the chip bag wider than it is deep, open at the top and pinched shut at the bottom', () => {
    const bag = makeLayerGeometry('bag');
    const b = box(bag);
    expect(b.max.x - b.min.x).toBeGreaterThan(1.3);
    expect(b.max.z - b.min.z).toBeLessThan((b.max.x - b.min.x) * 0.7);
    const position = bag.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      // Nothing closes the mouth: the chips go in there.
      if (y > b.max.y - 0.12) expect(Math.hypot(x, z)).toBeGreaterThan(0.2);
      // The crimped seam at the bottom is flat.
      if (y < b.min.y + 0.02) expect(Math.abs(z)).toBeLessThan(0.12);
    }
  });

  it('paints the bag blue', () => {
    const color = makeLayerGeometry('bag').getAttribute('color');
    let red = 0;
    let blue = 0;
    for (let i = 0; i < color.count; i++) {
      red += color.getX(i);
      blue += color.getZ(i);
    }
    expect(blue).toBeGreaterThan(red * 1.5);
  });

  it('stands the chips up out of the bag, higher than its rim', () => {
    const [bag, chips] = bagLayers('chicken');
    const rim = bag!.y + bag!.height / 2;
    const b = box(makeLayerGeometry('chips'));
    expect(chips!.y + b.max.y).toBeGreaterThan(rim + 0.2);
    expect(chips!.y + b.min.y).toBeLessThan(rim);
    expect(b.max.x - b.min.x).toBeLessThan(1.9);
  });

  it('makes the grilled chicken lighter than the seasoned beef', () => {
    const lightness = (kind: LayerKind) => {
      const color = makeLayerGeometry(kind).getAttribute('color');
      let sum = 0;
      for (let i = 0; i < color.count; i++) sum += color.getX(i) + color.getY(i) + color.getZ(i);
      return sum / color.count;
    };
    expect(lightness('chicken')).toBeGreaterThan(lightness('beef') * 1.2);
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
