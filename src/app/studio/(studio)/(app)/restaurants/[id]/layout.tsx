import type { ReactNode } from 'react';
import { BusinessLayout } from './BusinessLayout';

/** The frame of one restaurant in Menu and Cashier (see BusinessLayout). */
export default function RestaurantLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <BusinessLayout space="food" params={params}>
      {children}
    </BusinessLayout>
  );
}
