import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ImportWizard } from '@/app/pharmacy/_ui/ImportWizard';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.import.title') };
}

/**
 * The catalog import. Only a role that may apply imports has this screen; in a read-only pharmacy it says why and offers
 * nothing to upload. Prices in the file are applied only for a role that may change prices (the server decides).
 */
export default async function ImportPage() {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  if (!roleMay(access.actor, 'import.apply')) notFound();
  const t = getStudioTranslator(locale);
  const writable = access.writable('import.apply');
  const BackIcon = locale === 'en' ? ArrowLeft : ArrowRight;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={
          <div>
            <Link href="/pharmacy/catalog" className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-text underline underline-offset-2">
              <BackIcon aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.catalog.back')}
            </Link>
          </div>
        }
        title={t('pharmacy.import.title')}
        description={t('pharmacy.import.intro')}
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {writable.ok ? <ImportWizard canSetPrices={roleMay(access.actor, 'price.change')} /> : <WriteBlocked writable={writable} />}
      </div>
    </>
  );
}
