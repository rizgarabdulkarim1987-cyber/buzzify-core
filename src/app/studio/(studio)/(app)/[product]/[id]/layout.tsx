import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BusinessLayout } from '../../../restaurants/[id]/BusinessLayout';
import { loadRestaurant } from '../../../restaurants/[id]/load';

/** The frame of one retail shop. A business of another project is not found here. */
export default async function RetailShopLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const restaurant = await loadRestaurant((await params).id);
  if (restaurant.sector !== 'RETAIL') notFound();
  return (
    <BusinessLayout space="retail" params={params}>
      {children}
    </BusinessLayout>
  );
}
