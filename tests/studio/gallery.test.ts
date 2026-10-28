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

const gallery = (canSeeStyles: boolean) =>
  render(createElement(Gallery, { restaurantType: 'RESTAURANT', current: 'classic', selected: 'classic', onSelect: () => {}, canSeeStyles }));

describe('the template gallery', () => {
  for (const canSee of [true, false]) {
    it(`shows every category from the start, with no Styles button (may read style files: ${canSee})`, () => {
      const html = gallery(canSee);
      expect(html).toContain(`>${en('design.filter.categoryAll')}</button>`);
      for (const category of STYLE_CATEGORIES) expect(html).toContain(`>${en(`styles.category.${category}`).replaceAll('&', '&amp;')}</button>`);
      expect(html).not.toContain(`>${en('design.filter.styles')}</button>`);
    });
  }
});
