'use client';

import { motion } from 'motion/react';
import type { MenuProductView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { PlusIcon } from '@/ui/Icons';

export function ProductRow({ product, onOpen }: { product: MenuProductView; onOpen: (id: string) => void }) {
  const { t, money, addLine, announce } = useApp();
  const orderable = product.orderState === 'OK';
  const canQuickAdd = orderable && !product.needsChoices;

  return (
    <li data-testid="product-row" className="relative border-b border-line">
      <button
        type="button"
        onClick={() => onOpen(product.id)}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-4 text-start"
      >
        <span className="min-w-0">
          <span className="block font-display text-lg leading-snug">{product.name}</span>
          {product.description && (
            <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-muted">{product.description}</span>
          )}
          <span className="mt-2 block text-sm tabular-nums">{money(product.displayPrice)}</span>
          {!orderable && (
            <span className="mt-1 block text-sm text-accent">
              {t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable')}
            </span>
          )}
        </span>
        <ProductVisual
          media={product.media}
          name={product.name}
          slug={product.slug}
          className={`size-24 rounded-lg ${orderable ? '' : 'opacity-50'}`}
        />
      </button>
      {canQuickAdd && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          aria-label={t('product.quickAdd', { name: product.name })}
          onClick={() => {
            addLine({ productId: product.id, variantId: null, optionIds: [], quantity: 1 });
            track('ADD_TO_CART', { productId: product.id, payload: { source: 'quick-add' } });
            announce(t('cart.added', { name: product.name }));
          }}
          className="absolute end-3 bottom-3 grid size-11 place-items-center rounded-full bg-accent text-on-accent"
        >
          <PlusIcon />
        </motion.button>
      )}
    </li>
  );
}
