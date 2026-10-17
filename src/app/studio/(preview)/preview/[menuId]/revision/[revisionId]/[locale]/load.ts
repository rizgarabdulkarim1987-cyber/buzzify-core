import { notFound } from 'next/navigation';
import { cache } from 'react';
import { isLocale } from '@/lib/locale';
import { query } from '@/server/studio/framework/invoke';
import { view } from '@/server/studio/queries/revisions';

/** A published revision as guests got it, read once per request for the layout and the page. */
export const loadRevisionPreview = cache(async (menuId: string, revisionId: string, locale: string) => {
  if (!isLocale(locale)) notFound();
  return { locale, ...(await query(view, { menuId, revisionId, locale })) };
});
