import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { LevelsBody, levelSpot, worldHue } from '@/ui/template/bodies/LevelsBody';

describe('Game Levels shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.levels).toBe(LevelsBody);
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

  it('winds the road: three levels a row, every other row run backwards, the road turning down at each row end', () => {
    expect(levelSpot(0, 7)).toEqual({ row: 0, col: 0, link: 'across' });
    expect(levelSpot(1, 7)).toEqual({ row: 0, col: 1, link: 'across' });
    expect(levelSpot(2, 7)).toEqual({ row: 0, col: 2, link: 'down' });
    expect(levelSpot(3, 7)).toEqual({ row: 1, col: 2, link: 'across' });
    expect(levelSpot(5, 7)).toEqual({ row: 1, col: 0, link: 'down' });
    expect(levelSpot(6, 7)).toEqual({ row: 2, col: 0, link: 'none' });
    expect(levelSpot(1, 2)).toEqual({ row: 0, col: 1, link: 'none' });
  });

  it('gives neighbouring worlds different hues and repeats the set', () => {
    expect(worldHue(0)).not.toBe(worldHue(1));
    expect(worldHue(0)).toBe(worldHue(6));
  });
});
