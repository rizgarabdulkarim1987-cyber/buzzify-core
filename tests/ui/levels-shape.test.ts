import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { contrastRatio } from '@/lib/palette';
import { LevelsBody, levelSpot, worldFill, worldHue, worldInk } from '@/ui/template/bodies/LevelsBody';

describe('Game Levels shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('levels')).toBe(LevelsBody.name);
    expect(SHAPE_SETS.levels).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-lvl style', () => {
    const preset = TEMPLATES['the-game-levels'];
    expect(TEMPLATE_IDS).toContain('the-game-levels');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-game-levels') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('levels');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-lvl')).toBe('the-game-levels');
  });

  it('winds the road: one level a row, from the start edge through the middle to the end edge and back', () => {
    expect([0, 1, 2, 3, 4, 5].map((at) => levelSpot(at).step)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(levelSpot(0).card).toBe('end');
    expect(levelSpot(1).card).toBe('end');
    expect(levelSpot(2).card).toBe('start');
    expect(levelSpot(3).card).toBe('start');
  });

  it('gives neighbouring worlds different hues and repeats the set', () => {
    expect(worldHue(0)).not.toBe(worldHue(1));
    expect(worldHue(0)).toBe(worldHue(6));
  });

  it("writes the world numbers, labels and level badges in the ink that reads on each world's hue", () => {
    for (let index = 0; index < 6; index++) {
      expect(contrastRatio(worldInk(index), worldFill(index)), `world ${index + 1}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
