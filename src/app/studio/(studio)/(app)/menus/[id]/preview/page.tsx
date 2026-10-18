import type { Metadata } from 'next';
import { isLocale, type Locale } from '@/lib/locale';
import { query } from '@/server/studio/framework/invoke';
import * as previewQueries from '@/server/studio/queries/preview';
import { PreviewFrames } from '@/studio/workspace/PreviewFrames';
import { loadMenu, tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'preview');
}

/** The Preview tab: the draft in a phone frame and a desktop frame, in each of the menu's languages, and what the plan leaves out. */
export default async function MenuPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [menu, note] = await Promise.all([loadMenu(id), query(previewQueries.planNote, { menuId: id })]);
  const locales = menu.locales.filter(isLocale);
  const defaultLocale: Locale = isLocale(menu.defaultLocale) ? menu.defaultLocale : (locales[0] ?? 'en');
  return <PreviewFrames menuId={menu.id} name={menu.name} locales={locales} defaultLocale={defaultLocale} note={note} />;
}
