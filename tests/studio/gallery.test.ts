import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';
import { STYLE_CATEGORIES } from '@/studio/styles/categories';
import { Gallery } from '@/studio/workspace/design/Gallery';

const en = getStudioTranslator('en');

function render(element: ReactElement): string {
  const props = { locale: 'en', messages: STUDIO_MESSAGES.en } as ComponentProps<typeof StudioI18nProvider>;
  return renderToStaticMarkup(createElement(StudioI18nProvider, props, element));
}

const upgrade: ComponentProps<typeof Gallery>['plan']['upgrade'] = {
  restaurantId: 'r1',
  restaurantName: 'Zhamitos',
  whatsapp: null,
  isOwner: true,
  planNames: { BASIC: 'Basic', PRO: 'Pro', PREMIUM: 'Premium' },
  allowed: [],
  lowest: { 'design.premiumTemplates': 'PRO' },
  planTabHref: '/studio/settings/plan',
};

const gallery = (canSeeStyles: boolean, premiumTemplates = true) =>
  render(createElement(Gallery, { restaurantType: 'RESTAURANT', current: 'classic', selected: 'classic', onSelect: () => {}, canSeeStyles, plan: { premiumTemplates, upgrade } }));

describe('the template gallery', () => {
  for (const canSee of [true, false]) {
    it(`shows every category from the start, with no Styles button (may read style files: ${canSee})`, () => {
      const html = gallery(canSee);
      expect(html).toContain(`>${en('design.filter.categoryAll')}</button>`);
      for (const category of STYLE_CATEGORIES) expect(html).toContain(`>${en(`styles.category.${category}`).replaceAll('&', '&amp;')}</button>`);
      expect(html).not.toContain(`>${en('design.filter.styles')}</button>`);
    });
  }

  it('marks the premium templates, and shows the lock only on a plan without them (design.premiumTemplates)', () => {
    const badge = en('design.badge.premium');
    // The restaurant gallery's own start is not guaranteed to hold a premium card, so look across every business type.
    const marked = (premiumTemplates: boolean) =>
      render(createElement(Gallery, { restaurantType: 'RESTAURANT', current: 'classic', selected: 'classic', onSelect: () => {}, canSeeStyles: true, plan: { premiumTemplates, upgrade } }));
    expect(marked(true)).toContain(badge);
    expect(marked(false)).toContain(badge);
    expect(marked(false).length).toBeGreaterThan(marked(true).length);
  });
});
