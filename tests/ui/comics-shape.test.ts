import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { ComicsBody, panelSpans } from '@/ui/template/bodies/ComicsBody';

describe('Kitchen Comics shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.comics).toBe(ComicsBody);
    expect(SHAPE_SETS.comics).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-cmc style', () => {
    const preset = TEMPLATES['the-kitchen-comics'];
    expect(TEMPLATE_IDS).toContain('the-kitchen-comics');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-kitchen-comics') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('comics');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-cmc')).toBe('the-kitchen-comics');
  });

  it('lays a page out with a wide splash first and no hole in the two-column grid', () => {
    expect(panelSpans(0)).toEqual([]);
    expect(panelSpans(1)).toEqual([2]);
    for (let count = 1; count <= 40; count += 1) {
      const spans = panelSpans(count);
      expect(spans).toHaveLength(count);
      expect(spans[0], `count ${count}`).toBe(2);
      expect(spans.reduce((sum, span) => sum + span, 0) % 2, `count ${count} fills its last row`).toBe(0);
    }
    expect(panelSpans(9).filter((span) => span === 2).length).toBeGreaterThanOrEqual(2);
  });
});
