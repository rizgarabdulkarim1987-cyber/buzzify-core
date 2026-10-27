import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, toneOf } from '@/lib/appearance';
import { appearanceHtmlProps } from '@/studio/appearance-html';
import { BrandFooter } from '@/studio/shell/BrandFooter';
import { BrandLogo } from '@/studio/shell/BrandLogo';
import { Wordmark } from '@/studio/shell/Wordmark';

describe('toneOf', () => {
  it('is dark for a dark background and light for a light one', () => {
    expect(toneOf('#121212')).toBe('dark');
    expect(toneOf('#ffffff')).toBe('light');
    expect(toneOf('nonsense')).toBe('light');
  });
});

describe('appearanceHtmlProps tone', () => {
  it('marks <html> dark for a dark look and nothing for the default', () => {
    const dark = { font: 'studio', bg: '#121212', text: '#f2f2f2', button: '#f2b705', buttonText: '#111111', shape: 'square' } as const;
    expect(appearanceHtmlProps(dark)['data-tone']).toBe('dark');
    expect(appearanceHtmlProps(DEFAULT_APPEARANCE)['data-tone']).toBeUndefined();
  });
});

describe('BrandLogo', () => {
  const html = renderToStaticMarkup(createElement(BrandLogo, { height: 20 }));
  it('carries both the black and the white logo, one of which the stylesheet hides by tone', () => {
    expect(html).toContain('/brand/buzzify-on-light.png');
    expect(html).toContain('/brand/buzzify-on-dark.png');
    expect(html).toContain('brand-logo-light');
    expect(html).toContain('brand-logo-dark');
  });
  it('has one accessible name, not two', () => {
    expect(html.match(/alt="Buzzify"/g)).toHaveLength(1);
    expect(html.match(/alt=""/g)).toHaveLength(1);
  });
});

describe('BrandFooter', () => {
  it('is hidden when printing', () => {
    expect(renderToStaticMarkup(createElement(BrandFooter))).toContain('print:hidden');
  });
});

describe('Wordmark', () => {
  it('shows the logo and the word Core, and no typed Buzzify', () => {
    const html = renderToStaticMarkup(createElement(Wordmark));
    expect(html).toContain('/brand/buzzify-on-light.png');
    expect(html).toContain('Core');
    expect(html).not.toMatch(/>Buzzify</);
  });
});
