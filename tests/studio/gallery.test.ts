import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';
import { Gallery } from '@/studio/workspace/design/Gallery';

const en = getStudioTranslator('en');

function render(element: ReactElement): string {
  const props = { locale: 'en', messages: STUDIO_MESSAGES.en } as ComponentProps<typeof StudioI18nProvider>;
  return renderToStaticMarkup(createElement(StudioI18nProvider, props, element));
}

const gallery = (canSeeStyles: boolean) =>
  render(createElement(Gallery, { restaurantType: 'RESTAURANT', current: 'classic', selected: 'classic', onSelect: () => {}, canSeeStyles }));

describe('the template gallery', () => {
  it('offers the Styles filter to someone who may read the style files', () => {
    expect(gallery(true)).toContain(`>${en('design.filter.styles')}</button>`);
  });

  it('hides the Styles filter when the style files would answer "not found"', () => {
    expect(gallery(false)).not.toContain(`>${en('design.filter.styles')}</button>`);
  });
});
