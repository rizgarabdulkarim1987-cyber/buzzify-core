import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, LOOK_COOKIE, LOOKS, lookOf } from '@/app/pharmacy/_ui/sell-look';

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('the Sell screen look', () => {
  it('has seven looks, Classic first and the default', () => {
    expect(LOOKS).toEqual(['classic', 'rows', 'cards', 'split', 'board', 'register', 'stack']);
    expect(DEFAULT_LOOK).toBe('classic');
  });

  it('reads the device cookie, and falls back to Classic for anything unknown', () => {
    expect(LOOK_COOKIE).toBe('ph-look');
    expect(lookOf('rows')).toBe('rows');
    expect(lookOf('stack')).toBe('stack');
    expect(lookOf(undefined)).toBe('classic');
    expect(lookOf('photo')).toBe('classic');
    expect(lookOf('__proto__')).toBe('classic');
  });

  it('has a name for every look in every pharmacy language, and the dialog texts', () => {
    for (const lang of ['en', 'ar', 'ckb']) {
      const source = read(`src/studio/messages/pharmacy/${lang}.ts`);
      for (const key of ['pharmacy.sell.look.open', 'pharmacy.sell.look.title', 'pharmacy.sell.look.subtitle', 'pharmacy.sell.look.section', 'pharmacy.sell.look.sectionHint', ...LOOKS.map((id) => `pharmacy.sell.look.name.${id}`)]) {
        expect(source, `${lang} ${key}`).toContain(`'${key}'`);
      }
    }
  });

  it('has CSS for every look except Classic, only at lg and up', () => {
    const css = read('src/app/pharmacy/pharmacy.css');
    const at = css.indexOf('@media (min-width: 1024px)');
    expect(at).toBeGreaterThan(-1);
    for (const id of LOOKS.filter((l) => l !== 'classic')) {
      const rule = `[data-look='${id}']`;
      expect(css.indexOf(rule), id).toBeGreaterThan(at);
    }
  });
});
