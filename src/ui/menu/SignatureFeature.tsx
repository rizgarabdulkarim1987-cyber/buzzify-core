'use client';

import { motion } from 'motion/react';
import { stageTone } from '@/lib/stage';
import type { MenuProductView } from '@/server/data/menu-view';
import type { Daypart } from '@/server/domain/types';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { ProductStage } from '@/ui/stage/ProductStage';

export function SignatureFeature({
  product,
  daypart,
  onOpen,
  covered = false,
}: {
  product: MenuProductView;
  daypart: Daypart | null;
  onOpen: (id: string) => void;
  /** True while the product sheet is open over the hero, so the 3D stage can rest. */
  covered?: boolean;
}) {
  const { t, money } = useApp();
  const staged = stageTone(product.media) !== null;
  return (
    <motion.section
      aria-labelledby="signature-title"
      initial={{ y: 10 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', duration: 0.6, bounce: 0.1 }}
      className="px-4 pt-4 pb-6"
    >
      <p className="text-sm text-muted">{t(`signature.${daypart ?? 'NONE'}`)}</p>
      {staged && (
        <ProductStage
          product={product}
          variant="hero"
          testId="hero-stage"
          posterSlug={`${product.slug}-feature`}
          className="mt-2 aspect-[4/3] w-full rounded-xl"
          suspended={covered}
          onActivate={() => onOpen(product.id)}
        />
      )}
      <button type="button" onClick={() => onOpen(product.id)} className="mt-2 block w-full text-start">
        {!staged && (
          <ProductVisual
            media={product.media}
            name={product.name}
            slug={`${product.slug}-feature`}
            priority
            sizes="(min-width: 640px) 576px, 100vw"
            className="aspect-[4/3] w-full rounded-xl"
          />
        )}
        <span id="signature-title" className="mt-4 block font-display text-3xl leading-tight">
          {product.name}
        </span>
        {product.description && <span className="mt-2 block max-w-prose text-muted">{product.description}</span>}
        <span className="mt-3 block tabular-nums">{money(product.displayPrice)}</span>
      </button>
    </motion.section>
  );
}
