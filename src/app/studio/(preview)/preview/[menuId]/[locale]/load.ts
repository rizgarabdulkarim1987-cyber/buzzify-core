import { notFound } from 'next/navigation';
import { cache } from 'react';
import { isLocale } from '@/lib/locale';
import { query } from '@/server/studio/framework/invoke';
import { draft } from '@/server/studio/queries/preview';

/**
 * The draft preview of the page's address, read once per request for the layout (document, fonts, brand) and the page
 * (the menu). Signed out, the person is sent to sign in; another restaurant's menu, or a language the menu does not
 * offer, is not found.
 */
export const loadPreview = cache(async (menuId: string, locale: string) => {
  if (!isLocale(locale)) notFound();
  return { locale, ...(await query(draft, { menuId, locale })) };
});
