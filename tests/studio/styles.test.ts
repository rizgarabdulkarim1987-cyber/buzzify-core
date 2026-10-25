import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STYLE_GROUPS, MENU_STYLES, menuStyleById } from '@/studio/styles/catalog';
import { filterStyles } from '@/studio/styles/search';
import { STUDIO_MESSAGES } from '@/studio/messages';

const ids = MENU_STYLES.map((s) => s.id);
const arName = (id: string) => STUDIO_MESSAGES.ar[`styles.${id}.name`] ?? id;

describe('Menu styles catalog', () => {
  it('holds 35 styles with unique ids, numbered 1 to 35', () => {
    expect(MENU_STYLES).toHaveLength(35);
    expect(new Set(ids).size).toBe(35);
    expect(MENU_STYLES.map((s) => s.number)).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));
  });

  it('counts the groups', () => {
    const counts = Object.fromEntries(STYLE_GROUPS.map((g) => [g, MENU_STYLES.filter((s) => s.group === g).length]));
    expect(counts).toEqual({ themes: 8, heritage: 3, motion: 8, shapes: 16 });
  });

  it('contains the picked styles and none of the dropped ones', () => {
    expect(menuStyleById('motion-dep')).toBeDefined();
    expect(menuStyleById('layout-2-dep')).toBeDefined();
    for (const gone of ['themed-par', 'kurd-arab-and', 'kurd-arab-jli', 'kurd-arab-hwr', 'kurd-arab-chy', 'kurd-arab-sad']) {
      expect(menuStyleById(gone), gone).toBeUndefined();
    }
  });
});

describe('Menu styles messages', () => {
  for (const locale of ['en', 'ar', 'ckb'] as const) {
    const m = STUDIO_MESSAGES[locale];
    it(`${locale} names every style, group and the nav entry`, () => {
      for (const id of ids) {
        expect(m[`styles.${id}.name`], `${id} name`).toBeTruthy();
        expect(m[`styles.${id}.line`], `${id} line`).toBeTruthy();
      }
      for (const g of STYLE_GROUPS) expect(m[`styles.group.${g}`], g).toBeTruthy();
      expect(m['nav.styles']).toBeTruthy();
    });
    it(`${locale} has no stale style keys`, () => {
      const known = new Set(ids);
      const stale = Object.keys(m).filter((k) => {
        const hit = /^styles\.(.+)\.(name|line)$/.exec(k);
        return hit && !known.has(hit[1]!);
      });
      expect(stale).toEqual([]);
    });
  }
});

describe('filterStyles', () => {
  const find = (q: string, group: Parameters<typeof filterStyles>[1]['group'] = 'all') =>
    filterStyles(MENU_STYLES, { q, group }, arName).map((s) => s.id);

  it('finds a style by its Arabic name', () => {
    expect(find('مطار')).toEqual(['layout-2-dep']);
  });
  it('finds a style by its number, in Arabic digits or with #', () => {
    const third = MENU_STYLES[2]!.id;
    expect(find('٣')).toEqual([third]);
    expect(find('#3')).toEqual([third]);
  });
  it('filters by group', () => {
    expect(find('', 'heritage')).toHaveLength(3);
  });
  it('returns nothing for a miss', () => {
    expect(find('zzz')).toEqual([]);
  });
});

describe('style posters', () => {
  it.each(MENU_STYLES.map((s) => s.id))('has a poster under 60 KB for %s', (id) => {
    const file = path.join(process.cwd(), 'src/studio/styles/posters', `${id}.webp`);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(60 * 1024);
  });
});
