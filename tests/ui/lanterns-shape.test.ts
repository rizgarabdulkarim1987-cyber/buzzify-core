import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { LanternsBody } from '@/ui/template/bodies/LanternsBody';
import { contrast } from '@/ui/template/bodies/ink-bands';
import { DROPS, dropOf, NIGHT } from '@/ui/template/bodies/lanterns-night';

describe('the Ramadan Nights shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.lanterns).toBe(LanternsBody);
    expect(SHAPE_SETS.lanterns).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the kurd-arab-ram style', () => {
    const preset = TEMPLATES['the-ramadan-nights'];
    expect(TEMPLATE_IDS).toContain('the-ramadan-nights');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-ramadan-nights') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('lanterns');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('kurd-arab-ram')).toBe('the-ramadan-nights');
  });
});

describe('the lanterns', () => {
  it('hang on strings of a few lengths that repeat, the same one for the same place', () => {
    const drops = Array.from({ length: 40 }, (_, at) => dropOf(at));
    expect(new Set(drops).size).toBeGreaterThanOrEqual(3);
    expect(dropOf(7)).toBe(dropOf(7));
    expect(dropOf(DROPS.length + 2)).toBe(dropOf(2));
    expect(dropOf(-1)).toBe(DROPS[DROPS.length - 1]);
  });

  it('keeps every text on its fixed fill at 4.5:1 or more (the night is the same on every palette)', () => {
    expect(contrast(NIGHT.dimInk, NIGHT.dimPane)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(NIGHT.litInk, NIGHT.litPane)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(NIGHT.label, NIGHT.sky)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(NIGHT.labelLit, NIGHT.sky)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(NIGHT.ring, NIGHT.sky)).toBeGreaterThanOrEqual(3);
    expect(contrast(NIGHT.rope, NIGHT.sky)).toBeGreaterThanOrEqual(3);
  });
});
