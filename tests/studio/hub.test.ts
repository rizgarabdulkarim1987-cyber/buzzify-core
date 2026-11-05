import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getStudioTranslator } from '@/studio/messages';
import { ProjectHub } from '@/studio/shell/ProjectHub';
import { SPACES } from '@/studio/spaces';

const markup = (locale: 'en' | 'ar' | 'ckb' = 'en', spaces = SPACES) => renderToStaticMarkup(createElement(ProjectHub, { t: getStudioTranslator(locale), spaces }));

describe('ProjectHub', () => {
  it('shows five large product links, Menu and Cashier, Pharmacy and the three Retail products, and a small Platform link', () => {
    const html = markup();
    for (const home of ['/studio/overview', '/studio/pharmacy', '/studio/supermarket', '/studio/electronics', '/studio/clothing', '/studio/team']) {
      expect(html).toContain(`href="${home}"`);
    }
    expect(html).not.toContain('href="/studio/retail"');
    expect(html.match(/data-project="large"/g)).toHaveLength(5);
    expect(html.match(/data-project="small"/g)).toHaveLength(1);
  });

  it('draws each Retail product with its own icon: a cart, a phone and a shirt', () => {
    const html = markup();
    for (const icon of ['lucide-shopping-cart', 'lucide-smartphone', 'lucide-shirt', 'lucide-pill', 'lucide-utensils-crossed']) expect(html, icon).toContain(icon);
  });

  it('sits two to a row on a phone and keeps every tile one width from a tablet up', () => {
    const html = markup();
    expect(html.match(/w-\[calc\(50%-0\.375rem\)\][^"]*sm:w-44/g)).toHaveLength(5);
  });

  it('centres the icons on both axes of the screen', () => {
    const html = markup();
    expect(html).toMatch(/class="[^"]*min-h-dvh[^"]*items-center[^"]*justify-center/);
  });

  it('names every project in the three languages', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      const t = getStudioTranslator(locale);
      const html = markup(locale);
      for (const key of ['hub.food', 'hub.pharmacy', 'hub.supermarket', 'hub.electronics', 'hub.clothing', 'hub.platform']) {
        expect(t(key)).not.toBe(key);
        expect(html).toContain(t(key));
      }
    }
  });

  it('draws a new project as one more large icon without any other change', () => {
    const extra = { ...SPACES[1]!, id: 'clinic' as never, home: '/studio/clinic', prefix: '/studio/clinic' };
    expect(markup('en', [...SPACES, extra]).match(/data-project="large"/g)).toHaveLength(6);
  });
});
