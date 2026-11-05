import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';
import { businessPath, retailAddressIn, spaceOfBusiness } from '@/studio/spaces';
import { BusinessLayout } from '../../restaurants/[id]/BusinessLayout';
import { loadRestaurant } from '../../restaurants/[id]/load';
import { productOf } from '../product';

/**
 * The frame of one retail shop, in its own Retail product's space. A business of another project is not found here; a
 * shop opened under another product (an old Retail link, which lands in the Supermarket) moves to the same page in its own.
 */
export default async function RetailShopLayout({ children, params }: { children: ReactNode; params: Promise<{ product: string; id: string }> }) {
  const product = await productOf(params);
  const restaurant = await loadRestaurant((await params).id);
  if (restaurant.sector !== 'RETAIL') notFound();
  const own = spaceOfBusiness(restaurant.sector, restaurant.retailActivity);
  if (own !== product) {
    if (own === 'food' || own === 'pharmacy') notFound();
    const target = retailAddressIn((await headers()).get(REQUEST_PATH_HEADER) ?? '', product, own);
    redirect(target ?? businessPath(own, restaurant.id));
  }
  return (
    <BusinessLayout space={product} params={params}>
      {children}
    </BusinessLayout>
  );
}
