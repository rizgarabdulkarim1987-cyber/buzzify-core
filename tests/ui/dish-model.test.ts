import { describe, expect, it } from 'vitest';
import { modelOf } from '@/ui/product/DishModel';

const photo = { kind: 'image' as const, url: '/a.webp', alt: '', width: 1, height: 1 };

describe('the dish page model', () => {
  it('is the dish’s own 3D model, with AR when the menu view marked it', () => {
    expect(modelOf({ media: [photo, { kind: 'model3d', url: 'https://cdn.test/a.glb', ar: true }] })).toEqual({ kind: 'model3d', url: 'https://cdn.test/a.glb', ar: true });
  });

  it('is nothing for a dish with only photos, or whose plan hid the model', () => {
    expect(modelOf({ media: [photo] })).toBeNull();
    expect(modelOf({ media: [] })).toBeNull();
  });
});
