import type { Metadata } from 'next';
import { ProductEditor } from '@/app/pharmacy/_ui/ProductEditor';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { currencies, history } from '@/server/pharmacy/queries/prices';
import { categories, get } from '@/server/pharmacy/queries/products';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { catalogAccess } from '../access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.catalog.title') };
}

/**
 * One product: its editor and its price history. Every read is a framework query for the person's place; a product of
 * another business, or one that does not exist, is the 404 page. The controls follow the role and the pharmacy's state.
 */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, places] = await Promise.all([params, catalogAccess(), getPhPlaces()]);
  const input = access.placeInput;
  const [product, prices, categoryList, currencyList] = await Promise.all([
    query(get, { ...input, productId: id }),
    query(history, { ...input, productId: id }),
    query(categories, input),
    query(currencies, input),
  ]);
  const branches = places.find((p) => p.restaurantId === input.restaurantId)?.branches ?? [];
  const shown = access.place.branchId === null ? branches : branches.filter((b) => b.id === access.place.branchId);
  const price = access.writable('price.change');
  return (
    <ProductEditor
      userId={access.actor.userId}
      product={product}
      branches={shown}
      categories={categoryList}
      currencies={currencyList}
      history={prices.items}
      historyCursor={prices.nextCursor}
      writable={access.writable('catalog.manage')}
      canChangePrice={price.ok}
      place={access.place}
      branchNames={Object.fromEntries(branches.map((b) => [b.id, b.name]))}
    />
  );
}
