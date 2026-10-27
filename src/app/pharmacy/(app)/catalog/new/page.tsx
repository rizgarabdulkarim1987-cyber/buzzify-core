import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductEditor } from '@/app/pharmacy/_ui/ProductEditor';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { currencies } from '@/server/pharmacy/queries/prices';
import { categories } from '@/server/pharmacy/queries/products';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { catalogAccess, roleMay } from '../access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.catalog.newTitle') };
}

/**
 * A new product. Only a role that manages the catalog has this screen; in a read-only pharmacy it says so and offers no
 * save. The product's own id does not exist yet, so its draft is kept under "new" for this person on this device.
 */
export default async function NewProductPage() {
  const [access, places] = await Promise.all([catalogAccess(), getPhPlaces()]);
  if (!roleMay(access.actor, 'catalog.manage')) notFound();
  const input = access.placeInput;
  const [categoryList, currencyList] = await Promise.all([query(categories, input), query(currencies, input)]);
  const branches = places.find((p) => p.restaurantId === input.restaurantId)?.branches ?? [];
  const shown = access.place.branchId === null ? branches : branches.filter((b) => b.id === access.place.branchId);
  return (
    <ProductEditor
      userId={access.actor.userId}
      restaurantId={input.restaurantId}
      product={null}
      branches={shown}
      categories={categoryList}
      currencies={currencyList}
      history={[]}
      writable={access.writable('catalog.manage')}
      canChangePrice={false}
      place={access.place}
    />
  );
}
