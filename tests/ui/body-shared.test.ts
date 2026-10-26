import { describe, expect, it } from 'vitest';
import { withResults } from '@/ui/template/bodies/CabinetBody';
import { groupHue } from '@/ui/template/bodies/PeriodicBody';
import { stationHue } from '@/ui/template/bodies/MetroBody';
import { hueAt } from '@/ui/template/bodies/shared/hue';
import { keepInViewDelta } from '@/ui/template/bodies/shared/useKeepInView';

const box = (start: number, end: number) => ({ top: start, bottom: end, left: start, right: end });

describe('the pieces the browse shapes share', () => {
  it('picks a hue from a list by index, wrapping both ways', () => {
    const hues = [10, 20, 30] as const;
    expect(hueAt(hues, 0)).toBe(10);
    expect(hueAt(hues, 4)).toBe(20);
    expect(hueAt(hues, -1)).toBe(30);
    expect(stationHue(9)).toBe(stationHue(1));
    expect(groupHue(-1)).toBeGreaterThanOrEqual(0);
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
