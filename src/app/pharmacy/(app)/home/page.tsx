import type { Metadata } from 'next';
import { getPhAccess } from '@/server/pharmacy/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.shell.label') };
}

/**
 * The pharmacy's home: where the person works, and nothing else yet. It reads no pharmacy data; the screens that do
 * arrive with their own queries. The layout has already checked the person and their place.
 */
export default async function PharmacyHomePage() {
  const [access, locale] = await Promise.all([getPhAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const place = access.place?.branchName ?? t('pharmacy.branch.all');
  return (
    <PageHeader
      title={<span dir="auto">{place}</span>}
      description={t('pharmacy.home.intro', { place: access.actor?.restaurantName ?? '' })}
    />
  );
}
