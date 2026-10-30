import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU_STYLES, menuStyleById } from '@/studio/styles/catalog';
import { STUDIO_MESSAGES } from '@/studio/messages';
import { TEMPLATE_IDS } from '@/lib/templates';
import { STYLE_PRESETS } from '@/lib/templates/presets/styles';
import { TEMPLATE_FOR_STYLE, templateForStyle } from '@/studio/styles/template-map';

const ids = MENU_STYLES.map((s) => s.id);

describe('Menu styles catalog', () => {
  it('holds 123 styles with unique ids, numbered 1 to 123', () => {
    expect(MENU_STYLES).toHaveLength(123);
    expect(new Set(ids).size).toBe(123);
    expect(MENU_STYLES.map((s) => s.number)).toEqual(Array.from({ length: 123 }, (_, i) => i + 1));
  });

  it('contains the picked styles and none of the dropped ones', () => {
    expect(menuStyleById('motion-dep')).toBeDefined();
    expect(menuStyleById('layout-2-dep')).toBeDefined();
    for (const gone of ['themed-par', 'signature-2-film', 'kurd-arab-jli', 'kurd-arab-hwr', 'kurd-arab-chy', 'kurd-arab-sad']) {
      expect(menuStyleById(gone), gone).toBeUndefined();
    }
  });
});

describe('Menu styles messages', () => {
  for (const locale of ['en', 'ar', 'ckb'] as const) {
    const m = STUDIO_MESSAGES[locale];
    it(`${locale} names every style`, () => {
      for (const id of ids) {
        expect(m[`styles.${id}.name`], `${id} name`).toBeTruthy();
        expect(m[`styles.${id}.line`], `${id} line`).toBeTruthy();
      }
    });
    it(`${locale} has no stale style keys`, () => {
      const known = new Set(ids);
      const stale = Object.keys(m).filter((k) => {
        const hit = /^styles\.(.+)\.(name|line)$/.exec(k);
        return hit && !known.has(hit[1]!);
      });
      expect(stale).toEqual([]);
    });
    it(`${locale} keeps no keys of the removed Menu Styles area`, () => {
      const gone = Object.keys(m).filter((k) => k === 'nav.styles' || /^styles\.(library|detail)\./.test(k));
      expect(gone).toEqual([]);
    });
  }
});

describe('styles made real as templates', () => {
  it('keeps the three first-batch styles and maps every style preset from one catalog style', () => {
    expect(TEMPLATE_FOR_STYLE).toMatchObject({ 'themed-book': 'the-book', 'layout-mag': 'the-magazine', 'layout-2-dep': 'taste-airport' });
    expect(Object.values(TEMPLATE_FOR_STYLE).sort()).toEqual(STYLE_PRESETS.map((preset) => preset.id).sort());
  });
  it('maps only catalog styles to known templates', () => {
    for (const [styleId, templateId] of Object.entries(TEMPLATE_FOR_STYLE)) {
      expect(ids, styleId).toContain(styleId);
      expect(TEMPLATE_IDS, templateId).toContain(templateId);
    }
  });
  it('maps each template once', () => {
    const targets = Object.values(TEMPLATE_FOR_STYLE);
    expect(new Set(targets).size).toBe(targets.length);
  });
  it('makes every catalog style either a template or coming soon', () => {
    const real = Object.keys(TEMPLATE_FOR_STYLE).length;
    expect(real).toBeGreaterThanOrEqual(3);
    expect(MENU_STYLES.filter((s) => templateForStyle(s.id) !== null)).toHaveLength(real);
    expect(MENU_STYLES.filter((s) => templateForStyle(s.id) === null)).toHaveLength(MENU_STYLES.length - real);
    expect(templateForStyle('nope')).toBeNull();
  });
  for (const locale of ['en', 'ar', 'ckb'] as const) {
    it(`${locale} has the gallery's style labels`, () => {
      const m = STUDIO_MESSAGES[locale];
      for (const key of ['design.filter.styles', 'design.filter.stylesCount_other', 'design.comingSoon', 'design.comingSoonPreview', 'design.selectSoon']) expect(m[key], key).toBeTruthy();
    });
  }
});

describe('style posters', () => {
  it.each(MENU_STYLES.map((s) => s.id))('has a poster under 60 KB for %s', (id) => {
    const file = path.join(process.cwd(), 'src/studio/styles/posters', `${id}.webp`);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(60 * 1024);
  });
});
