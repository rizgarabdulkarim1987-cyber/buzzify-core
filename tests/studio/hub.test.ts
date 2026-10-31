import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getStudioTranslator } from '@/studio/messages';
import { ProjectHub } from '@/studio/shell/ProjectHub';
import { SPACES } from '@/studio/spaces';

const markup = (locale: 'en' | 'ar' | 'ckb' = 'en', spaces = SPACES) => renderToStaticMarkup(createElement(ProjectHub, { t: getStudioTranslator(locale), spaces }));

describe('ProjectHub', () => {
  it('shows two large project links, Menu and Cashier and Pharmacy, and a small Platform link', () => {
    const html = markup();
    expect(html).toContain('href="/studio/overview"');
    expect(html).toContain('href="/studio/pharmacy"');
    expect(html).toContain('href="/studio/team"');
    expect(html.match(/data-project="large"/g)).toHaveLength(2);
    expect(html.match(/data-project="small"/g)).toHaveLength(1);
  });

  it('centres the icons on both axes of the screen', () => {
    const html = markup();
    expect(html).toMatch(/class="[^"]*min-h-dvh[^"]*items-center[^"]*justify-center/);
  });

  it('names every project in the three languages', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      const t = getStudioTranslator(locale);
      const html = markup(locale);
      for (const key of ['hub.food', 'hub.pharmacy', 'hub.platform']) {
        expect(t(key)).not.toBe(key);
        expect(html).toContain(t(key));
      }
    }
  });

  it('draws a new project as one more large icon without any other change', () => {
    const extra = { ...SPACES[1]!, id: 'clinic' as never, home: '/studio/clinic', prefix: '/studio/clinic' };
    expect(markup('en', [...SPACES, extra]).match(/data-project="large"/g)).toHaveLength(3);
  });
});
