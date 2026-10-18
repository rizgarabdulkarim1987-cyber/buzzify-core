import { describe, expect, it } from 'vitest';
import {
  bagLayers,
  burgerLayers,
  croissantLayers,
  cupLayers,
  drinkStyle,
  explodeOffset,
  glassLayers,
  isStageArt,
  layersFor,
  millefeuilleLayers,
  qualifiesFor3D,
  selectionFromOptions,
  stageOf,
  stagesOnMenu,
  stageTone,
} from '@/lib/stage';

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

describe('drinkStyle', () => {
  it('gives milk drinks and matcha latte art and leaves espresso and tea plain', () => {
    expect(drinkStyle('#8A6A4B')).toBe('art'); // flat white
    expect(drinkStyle('#9B7653')).toBe('art'); // cappuccino
    expect(drinkStyle('#7A5A3F')).toBe('art'); // cortado
    expect(drinkStyle('#7F9A5E')).toBe('art'); // matcha latte
    expect(drinkStyle('#6B4A2F')).toBe('plain'); // espresso
    expect(drinkStyle('#B58B4C')).toBe('plain'); // earl grey
  });

  it('is plain for colours it cannot read', () => {
    expect(drinkStyle('nonsense')).toBe('plain');
  });
});

describe('cupLayers', () => {
  it('stacks saucer, cup and coffee', () => {
    expect(cupLayers().map((l) => l.key)).toEqual(['saucer', 'cup', 'coffee']);
  });

  it('seats the cup on the saucer and the coffee inside the cup', () => {
    const [saucer, cup, coffee] = cupLayers() as [ReturnType<typeof cupLayers>[0], ReturnType<typeof cupLayers>[0], ReturnType<typeof cupLayers>[0]];
    expect(saucer.y - saucer.height / 2).toBeCloseTo(0, 9);
    expect(cup.y - cup.height / 2).toBeCloseTo(saucer.y + saucer.height / 2, 9);
    expect(coffee.y).toBeGreaterThan(cup.y - cup.height / 2);
    expect(coffee.y + coffee.height / 2).toBeLessThan(cup.y + cup.height / 2);
  });
});

describe('the glass, the croissant and the mille-feuille', () => {
  it('puts ice and a lemon wheel inside and on the rim of the glass', () => {
    const [glass, liquid, ice, lemon] = glassLayers() as [
      ReturnType<typeof glassLayers>[0],
      ReturnType<typeof glassLayers>[0],
      ReturnType<typeof glassLayers>[0],
      ReturnType<typeof glassLayers>[0],
    ];
    expect([glass.key, liquid.key, ice.key, lemon.key]).toEqual(['glass', 'liquid', 'ice', 'lemon']);
    expect(liquid.y + liquid.height / 2).toBeLessThan(glass.y + glass.height / 2);
    expect(ice.y).toBeGreaterThan(liquid.y - liquid.height / 2);
    expect(lemon.y).toBeGreaterThan(glass.y + glass.height / 2 - 0.1);
  });

  it('is a single layer for the croissant', () => {
    expect(croissantLayers().map((l) => l.key)).toEqual(['croissant']);
  });

  it('stacks the mille-feuille: three sheets, two creams, icing on top', () => {
    const layers = millefeuilleLayers();
    expect(layers.map((l) => l.key)).toEqual(['puff-1', 'cream-1', 'puff-2', 'cream-2', 'puff-3', 'icing']);
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i]!.y - layers[i]!.height / 2).toBeCloseTo(layers[i - 1]!.y + layers[i - 1]!.height / 2, 9);
    }
  });

  it('chooses the layers by model', () => {
    const none = { cheese: false, patty: false, bacon: false };
    expect(layersFor('glass', none)).toEqual(glassLayers());
    expect(layersFor('croissant', none)).toEqual(croissantLayers());
    expect(layersFor('millefeuille', none)).toEqual(millefeuilleLayers());
  });
});

describe('the loaded chip bag', () => {
  it('fills the bag with chips, the meat, the vegetables, jalapeños and cheese sauce on top', () => {
    expect(bagLayers('chicken').map((l) => l.key)).toEqual(['bag', 'chips', 'chicken', 'veg', 'jalapeno', 'sauce']);
    expect(bagLayers('beef').map((l) => l.key)).toEqual(['bag', 'chips', 'beef', 'veg', 'jalapeno', 'sauce']);
  });

  it('stands the bag on the disc and heaps everything else in and above its open top', () => {
    const [bag, ...filling] = bagLayers('chicken');
    expect(bag!.y - bag!.height / 2).toBeCloseTo(0, 9);
    const rim = bag!.y + bag!.height / 2;
    for (const layer of filling) {
      expect(layer.y, layer.key).toBeGreaterThan(rim - 0.1);
      expect(layer.y + layer.height / 2, layer.key).toBeGreaterThan(rim);
    }
  });

  it('draws the chicken bag and the beef bag as two models', () => {
    expect(layersFor('bagchicken', none)).toEqual(bagLayers('chicken'));
    expect(layersFor('bagbeef', none)).toEqual(bagLayers('beef'));
  });

  it('keeps the bag on the plinth and lifts each filling higher than the one below it', () => {
    const layers = bagLayers('beef');
    const offsets = layers.map((layer) => explodeOffset('bagbeef', layers, layer.key));
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]!, layers[i]!.key).toBeGreaterThan(offsets[i - 1]!);
  });

  it('pulls the filling apart far enough that no two parts, or their labels, end up level', () => {
    const layers = bagLayers('chicken');
    const apart = layers.map((layer) => layer.y + explodeOffset('bagchicken', layers, layer.key));
    for (let i = 1; i < apart.length; i++) expect(apart[i]! - apart[i - 1]!, layers[i]!.key).toBeGreaterThan(0.15);
  });
});

describe('explodeOffset', () => {
  it('spreads a stack upward from its base: the bottom stays on the plinth, the top rises, in order', () => {
    const layers = burgerLayers({ cheese: true, patty: true, bacon: false });
    const offsets = layers.map((layer) => explodeOffset('burger', layers, layer.key));
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBeGreaterThan(0.5);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
  });

  it('spreads the mille-feuille the same way', () => {
    const layers = millefeuilleLayers();
    expect(explodeOffset('millefeuille', layers, 'puff-1')).toBe(0);
    expect(explodeOffset('millefeuille', layers, 'icing')).toBeGreaterThan(0);
  });

  it('lifts the cup off its saucer and the garnish off the glass', () => {
    const cup = cupLayers();
    expect(explodeOffset('cup', cup, 'saucer')).toBe(0);
    expect(explodeOffset('cup', cup, 'cup')).toBeGreaterThan(0);
    const glass = glassLayers();
    expect(explodeOffset('glass', glass, 'glass')).toBe(0);
    expect(explodeOffset('glass', glass, 'lemon')).toBeGreaterThan(explodeOffset('glass', glass, 'ice'));
  });

  it('leaves the croissant alone', () => {
    expect(explodeOffset('croissant', croissantLayers(), 'croissant')).toBe(0);
  });
});

describe('stageOf', () => {
  it('uses the art kind by default and an explicit model when one is named', () => {
    expect(stageOf([{ kind: 'art', art: 'glass', tone: '#E8D96A' }])).toEqual({ art: 'glass', tone: '#E8D96A' });
    expect(stageOf([{ kind: 'art', art: 'pastry', tone: '#9DB07A', model: 'millefeuille' }])).toEqual({
      art: 'millefeuille',
      tone: '#9DB07A',
    });
    expect(stageOf([{ kind: 'art', art: 'pastry', tone: '#C98B4A', model: 'croissant' }])?.art).toBe('croissant');
  });

  it('finds the model behind a photo, so the photo stays the picture and the model draws the 3D stage', () => {
    const photo = { kind: 'image' as const, url: '/a.jpg', alt: 'a', width: 1, height: 1 };
    expect(stageOf([photo, { kind: 'art', art: 'bowl', tone: '#E89A2C', model: 'bagchicken' }])).toEqual({
      art: 'bagchicken',
      tone: '#E89A2C',
    });
    expect(stageTone([photo, { kind: 'art', art: 'bowl', tone: '#E89A2C', model: 'bagbeef' }])).toBe('#E89A2C');
  });

  it('carries a scanned model that draws in place of the drawn one', () => {
    expect(stageOf([{ kind: 'art', art: 'bowl', tone: '#E89A2C', model: 'bagchicken', scan: '/api/assets/models/bag.glb' }])).toEqual({
      art: 'bagchicken',
      tone: '#E89A2C',
      scan: '/api/assets/models/bag.glb',
    });
  });

  it('has no stage for art without a model, or for a model it does not know', () => {
    expect(stageOf([{ kind: 'art', art: 'pastry', tone: '#C98B4A' }])).toBeNull();
    expect(stageOf([{ kind: 'art', art: 'pastry', tone: '#C98B4A', model: 'teapot' }])).toBeNull();
    expect(stageOf([{ kind: 'image', url: '/a.jpg', alt: 'a', width: 1, height: 1 }])).toBeNull();
  });
});

describe('stagesOnMenu', () => {
  const photo = { kind: 'image' as const, url: '/bag.webp', alt: 'Bag', width: 800, height: 800 };
  const art = { kind: 'art' as const, art: 'bowl' as const, tone: '#E89A2C', model: 'bagbeef', scan: '/api/assets/models/bag.glb' };

  it('shows guests choosing what to order the real photo, and keeps the 3D model for Explore', () => {
    expect(stagesOnMenu([photo, art])).toBe(false);
    expect(stageOf([photo, art])?.art).toBe('bagbeef');
  });

  it('draws the 3D model where there is no photo to show instead', () => {
    expect(stagesOnMenu([art])).toBe(true);
    expect(stagesOnMenu([{ kind: 'art', art: 'burger', tone: '#A5662F' }])).toBe(true);
  });

  it('has nothing to draw without a model', () => {
    expect(stagesOnMenu([photo])).toBe(false);
    expect(stagesOnMenu([])).toBe(false);
  });
});

describe('layersFor', () => {
  it('chooses the layer list by art kind', () => {
    const selection = { cheese: true, patty: false, bacon: false };
    expect(layersFor('burger', selection)).toEqual(burgerLayers(selection));
    expect(layersFor('cup', selection)).toEqual(cupLayers());
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
    expect(isStageArt('cup')).toBe(true);
    expect(isStageArt('bagchicken')).toBe(true);
    expect(isStageArt('bagbeef')).toBe(true);
    expect(isStageArt('plate')).toBe(false);
  });
});

describe('stageTone', () => {
  it('returns the art colour for art that has a stage', () => {
    expect(stageTone([{ kind: 'art', art: 'burger', tone: '#A5662F' }])).toBe('#A5662F');
    expect(stageTone([{ kind: 'art', art: 'cup', tone: '#8A6A4B' }])).toBe('#8A6A4B');
  });

  it('returns null for art without a stage, real images and empty media', () => {
    expect(stageTone([{ kind: 'art', art: 'plate', tone: '#A5662F' }])).toBeNull();
    expect(stageTone([{ kind: 'image', url: '/a.jpg', alt: 'a', width: 1, height: 1 }])).toBeNull();
    expect(stageTone([])).toBeNull();
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
