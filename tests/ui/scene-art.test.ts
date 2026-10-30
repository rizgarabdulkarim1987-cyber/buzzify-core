import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/templates';
import { borrowedArt } from '@/ui/scenes/borrow';
import { hasOwnScene, sceneIdFor } from '@/ui/scenes/three/registry';

describe('art a template without its own borrows', () => {
  it('borrows Neon Noir on a dark background and Gallery Blanc on a light one', () => {
    expect(borrowedArt({ bg: '#0E0E0E' })).toBe('neon-noir');
    expect(borrowedArt({ bg: '#F6F0E3' })).toBe('gallery-blanc');
  });

  it('keeps every preset 1 to 30 on its own 3D scene', () => {
    for (const preset of Object.values(TEMPLATES).filter((p) => p.number <= 30)) {
      expect(hasOwnScene(preset.id), preset.id).toBe(true);
      expect(sceneIdFor(preset.id, preset.palette), preset.id).toBe(preset.id);
    }
  });

  it('keeps the first three styles on the scenes they shipped with, whatever the palette', () => {
    for (const bg of ['#FFFFFF', '#000000']) {
      expect(sceneIdFor('the-book', { bg })).toBe('gallery-blanc');
      expect(sceneIdFor('the-magazine', { bg })).toBe('gallery-blanc');
      expect(sceneIdFor('taste-airport', { bg })).toBe('neon-noir');
    }
  });
});
