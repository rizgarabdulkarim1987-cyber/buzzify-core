import { Store } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { myRetailShops } from '@/server/studio/queries/retail';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('retail.choose.title') };
}

/**
 * The sign-in handoff sends an owner of several retail shops here to pick one. Each choice opens
 * `/studio/retail/open/[id]`, which sets the pick and resumes the handoff Retails started. Plain links, not `next/link`:
 * a prefetch must never run that Route Handler.
 */
export default async function ChooseRetailShopPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const shops = await query(myRetailShops, {});

  return (
    <>
      <PageHeader title={t('retail.choose.title')} description={shops.length > 0 ? t('retail.choose.intro') : undefined} />
      <div className="px-8 pb-10">
        {shops.length === 0 ? (
          <EmptyState icon={<Store aria-hidden />} title={t('retail.choose.empty')} />
        ) : (
          <ul className="flex max-w-xl flex-col divide-y divide-line overflow-hidden rounded-lg border border-line">
            {shops.map((shop) => (
              <li key={shop.id}>
                <a
                  href={`/studio/retail/open/${encodeURIComponent(shop.id)}`}
                  className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-base text-text hover:bg-surface-muted focus-visible:bg-surface-muted"
                >
                  <span className="min-w-0 break-words">{shop.name}</span>
                  {!shop.provisioned && <StatusBadge>{t('retail.choose.preparing')}</StatusBadge>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
