import { describe, expect, it } from 'vitest';
import { focusOf, nearestOf, padCount, starPolygon, stepTo } from '@/ui/template/bodies/CoverflowBody';

describe('the coverflow body', () => {
  it('brings the card at the middle fully forward and fades it out a card and a tenth away', () => {
    expect(focusOf(0, 100)).toBe(1);
    expect(focusOf(55, 100)).toBeCloseTo(0.5);
    expect(focusOf(-55, 100)).toBeCloseTo(0.5);
    expect(focusOf(110, 100)).toBeCloseTo(0, 6);
    expect(focusOf(400, 100)).toBe(0);
    expect(focusOf(0, 0)).toBe(0);
  });

  it('counts the most forward card, the first of equals, 0 for an empty row', () => {
    expect(nearestOf([0.2, 0.9, 0.4])).toBe(1);
    expect(nearestOf([0.5, 0.5])).toBe(0);
    expect(nearestOf([])).toBe(0);
  });

  it('steps one card with the arrows and stays inside the row', () => {
    expect(stepTo(0, 1, 4)).toBe(1);
    expect(stepTo(0, -1, 4)).toBe(0);
    expect(stepTo(3, 1, 4)).toBe(3);
    expect(stepTo(0, 1, 0)).toBe(0);
  });

  it('pads the counter to two digits', () => {
    expect(padCount(3)).toBe('03');
    expect(padCount(12)).toBe('12');
    expect(padCount(-1)).toBe('00');
  });

  it('draws the zellige star with eight tips at the rim and eight notches inside, the first tip at the top', () => {
    const star = starPolygon();
    const corners = star.slice('polygon('.length, -1).split(', ');
    expect(corners).toHaveLength(16);
    expect(corners[0]).toBe('50.0% 0.0%');
    expect(corners[4]).toBe('100.0% 50.0%');
    const radius = (corner: string) => {
      const [x, y] = corner.split(' ').map((part) => Number.parseFloat(part) - 50);
      return Math.hypot(x!, y!);
    };
    corners.forEach((corner, at) => expect(radius(corner)).toBeCloseTo(at % 2 ? 38 : 50, 0));
  });
});
