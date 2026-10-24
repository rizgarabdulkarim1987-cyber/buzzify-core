import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getPosAccess } from '@/server/pos/actor';
import { posEntry } from '@/server/pos/entry';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.inactive.title') };
}

/** Why the till is closed for this person's restaurant. An open till has nothing to say here and goes home. */
export default async function PosInactivePage() {
  const entry = posEntry(await getPosAccess());
  if (entry.kind === 'signIn') redirect(entry.to);
  if (entry.kind === 'notFound') notFound();
  if (entry.kind === 'open') redirect('/pos');

  const t = getStudioTranslator(await requestStudioLocale());
  return (
    <main id="main">
      <PageHeader title={t('pos.inactive.title')} description={t(`pos.inactive.${entry.reason}`)} />
      <p className="px-8 pb-8">
        <Link href="/studio" className="text-sm underline underline-offset-2">
          {t('pos.inactive.studio')}
        </Link>
      </p>
    </main>
  );
}
