import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posBoard } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { TablesBoard } from '@/app/pos/_ui/TablesBoard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.board.title') };
}

export default async function TablesPage() {
  const [board, locale] = await Promise.all([query(posBoard, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.board.title')} />
      <TablesBoard board={board} />
    </>
  );
}
