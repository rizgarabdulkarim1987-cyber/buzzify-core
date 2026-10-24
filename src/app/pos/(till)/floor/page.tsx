import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posFloor } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { FloorSetup } from './FloorSetup';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.floor.title') };
}

export default async function FloorPage() {
  const [floor, locale] = await Promise.all([query(posFloor, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.floor.title')} description={t('pos.floor.intro')} />
      <FloorSetup floor={floor} />
    </>
  );
}
