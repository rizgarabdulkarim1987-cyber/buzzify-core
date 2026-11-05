import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const css = readFileSync(join(root, 'src/app/pharmacy/pharmacy.css'), 'utf8');
const studio = readFileSync(join(root, 'src/studio/studio.css'), 'utf8');

const NAMES = [
  'canvas', 'card', 'line', 'text', 'muted', 'g9', 'g8', 'g6', 'g1', 'blue', 'blue-wash', 'red', 'red-wash',
  'amber-ink', 'amber-wash', 'accent', 'on-green', 'on-green-muted', 'badge', 'badge-ink',
];

function token(name: string): string {
  const m = css.match(new RegExp(`--ph-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`--ph-${name} missing`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('pharmacy design tokens', () => {
  it('defines every --ph-* token on .ph', () => {
    expect(css).toMatch(/\.ph\s*\{/);
    for (const n of NAMES) expect(() => token(n)).not.toThrow();
  });

  it('exposes --color-ph-* Tailwind aliases', () => {
    for (const n of NAMES) expect(studio).toContain(`--color-ph-${n}: var(--ph-${n});`);
  });

  it('every text/background pair passes WCAG AA (4.5:1)', () => {
    const pairs: [string, string][] = [
      ['text', 'canvas'], ['text', 'card'], ['muted', 'canvas'], ['muted', 'card'], ['on-green', 'g8'],
      ['on-green', 'g9'], ['amber-ink', 'amber-wash'], ['red', 'red-wash'], ['blue', 'blue-wash'], ['g6', 'g1'],
      ['on-green-muted', 'g9'], ['on-green-muted', 'g8'], ['badge-ink', 'badge'], ['g8', 'card'],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has no motion or backdrop-filter, and a flat rail colour', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/transition|animation|backdrop-filter|gradient/);
  });
});
