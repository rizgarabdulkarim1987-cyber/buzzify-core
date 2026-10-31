import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BusinessLayout } from '../../restaurants/[id]/BusinessLayout';
import { loadRestaurant } from '../../restaurants/[id]/load';

/** The frame of one pharmacy. A business of the other project is not found here. */
export default async function PharmacyLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const restaurant = await loadRestaurant((await params).id);
  if (restaurant.sector !== 'PHARMACY') notFound();
  return (
    <BusinessLayout space="pharmacy" params={params}>
      {children}
    </BusinessLayout>
  );
}
