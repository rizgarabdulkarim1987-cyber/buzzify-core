import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { brandCss } from '@/ui/brand';

const brand = {
  logoText: 'ATELIER',
  theme: 'dark' as const,
  motionIntensity: 'subtle' as const,
  tokens: DEFAULT_PALETTES,
};

describe('brandCss', () => {
  it('emits dark variables for the root and light variables for the light theme', () => {
    const css = brandCss(brand);
    expect(css).toContain('html:root{');
    expect(css).toContain('--bg:#0E0E0F');
    expect(css).toContain("html:root[data-theme='light']{");
    expect(css).toContain('--bg:#F7F5F1');
    expect(css).toContain('--accent:#D6BC8A');
  });

  it('never emits anything but hex colours', () => {
    const hostile = {
      ...brand,
      tokens: { ...DEFAULT_PALETTES, dark: { ...DEFAULT_PALETTES.dark, bg: 'red;}body{display:none' } },
    };
    const css = brandCss(hostile);
    expect(css).not.toContain('display:none');
    expect(css).toContain(`--bg:${DEFAULT_PALETTES.dark.bg}`);
  });
});
