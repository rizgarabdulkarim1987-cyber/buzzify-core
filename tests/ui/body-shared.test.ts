import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/templates';
import { contrastRatio } from '@/lib/palette';
import { withResults } from '@/ui/template/bodies/CabinetBody';
import { groupHue } from '@/ui/template/bodies/PeriodicBody';
import { stationHue } from '@/ui/template/bodies/MetroBody';
import { appHue } from '@/ui/template/bodies/HomescreenBody';
import { worldHue } from '@/ui/template/bodies/LevelsBody';
import { hueAt, SHAPE_HUES } from '@/ui/template/bodies/shared/hue';
import { saleOff } from '@/ui/template/parts';
import type { MenuProductView } from '@/server/data/menu-view';
import { keepInViewDelta } from '@/ui/template/bodies/shared/useKeepInView';

const box = (start: number, end: number) => ({ top: start, bottom: end, left: start, right: end });

describe('the pieces the browse shapes share', () => {
  it('picks a hue from a list by index, wrapping both ways', () => {
    const hues = [10, 20, 30] as const;
    expect(hueAt(hues, 0)).toBe(10);
    expect(hueAt(hues, 4)).toBe(20);
    expect(hueAt(hues, -1)).toBe(30);
    expect(stationHue(9)).toBe(stationHue(1));
    expect(groupHue(-1)).toBe(groupHue(7));
  });

  it('gives the home screen dock and the game worlds the one shared colour set', () => {
    for (const index of [0, 1, 5, 6]) {
      expect(appHue(index)).toBe(hueAt(SHAPE_HUES, index));
      expect(worldHue(index)).toBe(hueAt(SHAPE_HUES, index));
    }
  });

  it('reads a live discount for the sale chip, and none without a regular price', () => {
    const dish = (fields: Partial<MenuProductView>) => fields as MenuProductView;
    expect(saleOff(dish({ regularPrice: 500, percentOff: 20 }))).toBe(20);
    expect(saleOff(dish({ percentOff: 20 }))).toBe(0);
    expect(saleOff(dish({ regularPrice: 500, percentOff: 0 }))).toBe(0);
  });

  it('moves a strip only as far as it takes to show the lit item, on either axis', () => {
    expect(keepInViewDelta(box(0, 100), box(20, 60), 'x', 16)).toBe(0);
    expect(keepInViewDelta(box(0, 100), box(90, 130), 'x', 16)).toBe(46);
    expect(keepInViewDelta(box(0, 100), box(-30, 10), 'y', 16)).toBe(-46);
    expect(keepInViewDelta(box(0, 100), box(5, 40), 'y', 24)).toBe(-19);
  });
});

describe('the Drawer Cabinet under a search or a filter', () => {
  it('opens every drawer that holds a result and leaves the others as they were', () => {
    const open = new Set(['a']);
    const next = withResults(open, ['c', 'd']);
    expect([...next].sort()).toEqual(['a', 'c', 'd']);
    expect(open.has('c')).toBe(false);
  });

  it('returns the same set when every drawer with a result is already open', () => {
    const open = new Set(['a', 'b']);
    expect(withResults(open, ['b'])).toBe(open);
  });
});

describe('text on the accent in the browse shapes', () => {
  // Shelves' aisle sign, count and add button and Tabletop's lit napkin draw text on the accent with --on-accent: the
  // pair reads on each of the shape's palettes, the light "Night market" yellow and the dark "Pale oak" rust included.
  it.each(['the-supermarket-shelves', 'the-table-from-above'] as const)('reads on every palette of %s', (id) => {
    for (const { palette } of TEMPLATES[id].palettes) expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
