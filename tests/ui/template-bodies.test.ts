import { describe, expect, it } from 'vitest';
import { BODY_KINDS, SHAPE_SETS, templateList } from '@/lib/templates';
import { BODIES } from '@/ui/template/bodies';
import { BoardBody } from '@/ui/template/bodies/BoardBody';
import { BookBody } from '@/ui/template/bodies/BookBody';
import { MagazineBody } from '@/ui/template/bodies/MagazineBody';

describe('the body registry', () => {
  it('has a component for every shaped body and none for scroll, which the menu draws itself', () => {
    expect(Object.keys(BODIES).sort()).toEqual(BODY_KINDS.filter((kind) => kind !== 'scroll').sort());
    for (const [kind, component] of Object.entries(BODIES)) expect(typeof component, kind).toBe('function');
  });

  it('keeps the first three shapes on their own components', () => {
    expect(BODIES.book).toBe(BookBody);
    expect(BODIES.magazine).toBe(MagazineBody);
    expect(BODIES.board).toBe(BoardBody);
  });

  it('gives every shaped body a preset that starts on it, with the knobs it sets left to the shape', () => {
    for (const kind of BODY_KINDS.filter((k) => k !== 'scroll')) {
      const presets = templateList().filter((preset) => preset.layout.body === kind);
      expect(presets.length, kind).toBeGreaterThanOrEqual(1);
      expect(SHAPE_SETS[kind], kind).toBeDefined();
    }
  });
});
