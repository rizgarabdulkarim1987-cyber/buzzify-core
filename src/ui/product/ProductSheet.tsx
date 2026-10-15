'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { Sheet } from '@/ui/Sheet';
import { ProductDetail } from './ProductDetail';

export function ProductSheet({
  product,
  close,
  open,
}: {
  product: MenuProductView;
  /** Called once the exit animation has finished. */
  close: () => void;
  /** Swaps the open product in place (history is replaced, not pushed). */
  open: (id: string, replace?: boolean) => void;
}) {
  const titleId = `sheet-title-${product.slug}`;
  return (
    <Sheet labelledBy={titleId} onClose={close}>
      {(requestClose) => (
        <ProductDetail
          key={product.id}
          product={product}
          mode="sheet"
          titleId={titleId}
          onDone={requestClose}
          onSwitch={(id) => open(id, true)}
        />
      )}
    </Sheet>
  );
}
