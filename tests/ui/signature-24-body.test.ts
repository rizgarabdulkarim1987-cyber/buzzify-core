import { describe, expect, it } from 'vitest';
import {
  bandSeconds,
  cssUrl,
  drawingRef,
  fillOf,
  GIANT_FLOOR,
  GIANT_MAX,
  GIANT_MIN,
  giantSize,
  giantTone,
  sheetOf,
  twoDigits,
  WALL_START,
  WALL_TILES,
  wallColumns,
  wallDelta,
  wallStep,
  zoneColumns,
  zoomScroll,
} from '@/ui/template/bodies/signature-24';

const latin = (value: number) => String(value);
const arabic = (value: number) => value.toLocaleString('ar-IQ', { useGrouping: false });

describe('The Blueprint', () => {
  it('numbers a drawing by its sheet and its place on it, two digits each', () => {
    expect(drawingRef(0, 0, latin)).toBe('DWG-01·01');
    expect(drawingRef(11, 8, latin)).toBe('DWG-12·09');
    expect(twoDigits(3, arabic)).toBe('٠٣');
  });

  it('gives a sheet its place of all the sections, never past the total', () => {
    expect(sheetOf(2, 7, latin)).toBe('03/07');
    expect(sheetOf(4, 3, latin)).toBe('05/05');
  });
});

describe('Giant Type', () => {
  it('sets a short name as large as allowed and a long one smaller', () => {
    expect(giantSize('Grill')).toBe(GIANT_MAX);
    expect(giantSize('مشاوي')).toBe(GIANT_MAX);
    expect(giantSize('مشروبات باردة')).toBeLessThan(GIANT_MAX);
    expect(giantSize('Hot and cold drinks from the bar')).toBe(GIANT_MIN);
  });

  it('keeps the longest word inside the width, so no word ever breaks', () => {
    for (const name of ['المقبلات الباردة والساخنة', 'Superlongsinglewordsectionname', 'سلطات', 'x']) {
      const size = giantSize(name);
      const longest = Math.max(...name.split(' ').map((word) => [...word].length));
      expect(longest * size * 0.62).toBeLessThanOrEqual(94.5);
      expect(size).toBeGreaterThanOrEqual(GIANT_FLOOR);
    }
  });

  it('fills the letters with the first photo of the section, or a poster, or nothing', () => {
    const image = { kind: 'image' as const, url: '/m/a.webp', alt: '', width: 1, height: 1 };
    const art = { kind: 'art' as const, art: 'cup' as const, tone: '#fff' };
    expect(fillOf([{ media: [art] }, { media: [image] }])).toBe('/m/a.webp');
    expect(fillOf([{ media: [{ kind: 'video', url: '/v.mp4', poster: '/p.jpg' }] }])).toBe('/p.jpg');
    expect(fillOf([{ media: [art] }, { media: [] }])).toBeNull();
  });

  it('quotes a URL so it can never close the CSS value', () => {
    expect(cssUrl('/a b.jpg')).toBe('url("/a b.jpg")');
    expect(cssUrl('/a".jpg')).toBe('url("/a%22.jpg")');
    expect(cssUrl('/a\\b')).not.toContain('\\');
  });

  it('cycles five colours by the section place, and runs the band at one pace', () => {
    expect([0, 1, 4, 5, 9].map(giantTone)).toEqual([0, 1, 4, 0, 4]);
    expect(giantTone(-1)).toBe(4);
    expect(bandSeconds(2)).toBe(14);
    expect(bandSeconds(10)).toBe(35);
  });
});

describe('The Open Wall', () => {
  it('lays the zones out about square, at most three side by side', () => {
    expect([0, 1, 2, 4, 5, 9, 16].map(wallColumns)).toEqual([1, 1, 2, 2, 3, 3, 3]);
    expect([0, 1, 2, 3, 12].map(zoneColumns)).toEqual([1, 1, 2, 3, 3]);
  });

  it('steps the tiles within range, starting in the middle', () => {
    expect(WALL_TILES[WALL_START]).toBe(6.75);
    expect(wallStep(0, -1)).toBe(0);
    expect(wallStep(0, 1)).toBe(1);
    expect(wallStep(WALL_TILES.length - 1, 1)).toBe(WALL_TILES.length - 1);
  });

  it('first screen: three default tiles of a zone fit a 375px phone with the wall and zone padding', () => {
    const px = WALL_TILES[WALL_START] * 16;
    expect(8 + 12 + 3 * px + 2 * 10).toBeLessThanOrEqual(375);
  });

  it('brings a zone to the start corner, from the right in a right-to-left menu', () => {
    const frame = { top: 100, left: 0, right: 375 };
    const zone = { top: 700, left: 900, right: 1260 };
    expect(wallDelta(zone, frame, false, 8)).toEqual({ top: 592, left: 892 });
    expect(wallDelta({ top: 700, left: -1000, right: -640 }, frame, true, 8)).toEqual({ top: 592, left: -1007 });
  });

  it('keeps the middle of the view in place when the wall grows or shrinks', () => {
    expect(zoomScroll(0, 400, 2, false)).toBe(200);
    expect(zoomScroll(100, 400, 0.5, false)).toBe(0);
    expect(zoomScroll(0, 400, 2, true)).toBe(-200);
    expect(zoomScroll(-300, 400, 1, true)).toBeCloseTo(-300);
  });
});
