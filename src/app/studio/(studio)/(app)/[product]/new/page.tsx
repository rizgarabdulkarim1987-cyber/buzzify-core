import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { newRestaurantAccess } from '@/server/studio/queries/restaurants';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { spaceT } from '@/studio/space-words';
import { businessBase, isRetailSpace } from '@/studio/spaces';
import { PageHeader } from '@/studio/ui/PageHeader';
import { CreateRestaurantForm } from '../../restaurants/RestaurantForm';
import { productOf, type ProductParams } from '../product';

export async function generateMetadata({ params }: ProductParams): Promise<Metadata> {
  const { product } = await params;
  const t = getStudioTranslator(await requestStudioLocale());
  return { title: (isRetailSpace(product) ? spaceT(t, product) : t)('retail.new') };
}

/**
 * A new shop of this Retail product: the create form fixed on the Retail sector and on the product of the space it is in
 * (a new Electronics shop is an Electronics shop; it cannot be changed later), with the way back to the product's list. A
 * retail shop has no menu plan, so no plan names are read.
 */
export default async function NewRetailShopPage({ params }: ProductParams) {
  const product = await productOf(params);
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  await query(newRestaurantAccess, {});
  const t = spaceT(getStudioTranslator(actor.locale), product);

  return (
    <>
      <PageHeader
        above={
          <Link href={businessBase(product)} className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('retail.title')}
          </Link>
        }
        title={t('retail.new')}
        description={t('retail.newDescription')}
      />
      <div className="px-8 pb-2">
        <CreateRestaurantForm initialSector="RETAIL" space={product} />
      </div>
    </>
  );
}
