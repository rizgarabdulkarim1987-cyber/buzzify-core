import { describe, expect, it } from 'vitest';
import { burgerLayers, isStageArt, qualifiesFor3D, selectionFromOptions } from '@/lib/stage';

const none = { cheese: false, patty: false, bacon: false };

describe('burgerLayers', () => {
  it('stacks the plain burger bottom to top', () => {
    expect(burgerLayers(none).map((l) => l.key)).toEqual([
      'bun-bottom',
      'lettuce',
      'tomato',
      'patty',
      'pickles',
      'bun-top',
    ]);
  });

  it('adds a second patty directly above the first and raises everything above it', () => {
    const plain = burgerLayers(none);
    const double = burgerLayers({ ...none, patty: true });
    expect(double.map((l) => l.key)).toEqual([
      'bun-bottom',
      'lettuce',
      'tomato',
      'patty',
      'patty-2',
      'pickles',
      'bun-top',
    ]);
    const top = (layers: typeof plain) => layers[layers.length - 1]!.y;
    expect(top(double)).toBeGreaterThan(top(plain));
  });

  it('puts bacon above the top patty and cheese above the bacon', () => {
    const keys = burgerLayers({ cheese: true, patty: true, bacon: true }).map((l) => l.key);
    expect(keys.indexOf('patty-2')).toBeLessThan(keys.indexOf('bacon'));
    expect(keys.indexOf('bacon')).toBeLessThan(keys.indexOf('cheese'));
    expect(keys.indexOf('cheese')).toBeLessThan(keys.indexOf('pickles'));
  });

  it('never overlaps layers and has unique keys', () => {
    const layers = burgerLayers({ cheese: true, patty: true, bacon: true });
    expect(new Set(layers.map((l) => l.key)).size).toBe(layers.length);
    for (let i = 1; i < layers.length; i++) {
      const below = layers[i - 1]!;
      const here = layers[i]!;
      expect(here.y - here.height / 2).toBeGreaterThanOrEqual(below.y + below.height / 2 - 1e-9);
    }
  });

  it('starts the stack on the disc', () => {
    const first = burgerLayers(none)[0]!;
    expect(first.y - first.height / 2).toBeCloseTo(0, 9);
  });
});

describe('selectionFromOptions', () => {
  const options = [
    { id: 'a', visualKey: 'cheese' },
    { id: 'b', visualKey: 'patty' },
    { id: 'c', visualKey: null },
    { id: 'd', visualKey: 'bacon' },
  ];

  it('turns selected option ids into visual flags', () => {
    expect(selectionFromOptions(options, ['b', 'c'])).toEqual({ cheese: false, patty: true, bacon: false });
    expect(selectionFromOptions(options, ['a', 'b', 'd'])).toEqual({ cheese: true, patty: true, bacon: true });
  });

  it('ignores unknown ids and options with no visual effect', () => {
    expect(selectionFromOptions(options, ['zzz', 'c'])).toEqual(none);
  });
});

describe('isStageArt', () => {
  it('knows which art kinds have a 3D stage', () => {
    expect(isStageArt('burger')).toBe(true);
    expect(isStageArt('cup')).toBe(false);
  });
});

describe('qualifiesFor3D', () => {
  const ok = { webgl: true, saveData: false };

  it('accepts a capable device', () => {
    expect(qualifiesFor3D({ ...ok, deviceMemory: 8, cores: 8 })).toBe(true);
  });

  it('accepts when memory and cores are not exposed', () => {
    expect(qualifiesFor3D(ok)).toBe(true);
  });

  it('refuses without WebGL, on data saver, on low memory or with few cores', () => {
    expect(qualifiesFor3D({ ...ok, webgl: false })).toBe(false);
    expect(qualifiesFor3D({ ...ok, saveData: true })).toBe(false);
    expect(qualifiesFor3D({ ...ok, deviceMemory: 2 })).toBe(false);
    expect(qualifiesFor3D({ ...ok, cores: 2 })).toBe(false);
  });

  it('lets the visitor force it off, or on where WebGL exists', () => {
    expect(qualifiesFor3D({ ...ok, forced: 'off' })).toBe(false);
    expect(qualifiesFor3D({ webgl: true, saveData: true, deviceMemory: 2, forced: 'on' })).toBe(true);
    expect(qualifiesFor3D({ webgl: false, saveData: false, forced: 'on' })).toBe(false);
  });
});
