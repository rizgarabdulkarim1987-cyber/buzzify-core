'use client';

import { motion } from 'motion/react';
import { stageTone } from '@/lib/stage';
import type { MenuProductView } from '@/server/data/menu-view';
import type { Daypart } from '@/server/domain/types';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { ProductStage } from '@/ui/stage/ProductStage';

/**
 * The signature of the hour. The object stands in a pool of light, runs edge to edge and dissolves
 * into the page; the name is set large and overlaps its lower edge, aligned to the reading start.
 */
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
      initial={{ opacity: 0.001, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', duration: 0.6, bounce: 0.08 }}
      className="pt-3"
    >
      <p className="px-5 text-sm text-muted">{t(`signature.${daypart ?? 'NONE'}`)}</p>
      <div
        data-hero-stage
        className="stage-light grain relative isolate mt-1 [mask-image:linear-gradient(to_bottom,transparent,#000_16%,#000_70%,transparent)]"
      >
        {staged ? (
          <ProductStage
            product={product}
            variant="hero"
            testId="hero-stage"
            posterSlug={`${product.slug}-feature`}
            className="aspect-[5/4] w-full"
            suspended={covered}
            onActivate={() => onOpen(product.id)}
          />
        ) : (
          <button type="button" onClick={() => onOpen(product.id)} className="block w-full" tabIndex={-1} aria-hidden="true">
            <ProductVisual
              media={product.media}
              name={product.name}
              slug={`${product.slug}-feature`}
              priority
              sizes="(min-width: 640px) 576px, 100vw"
              className="aspect-[5/4] w-full"
            />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen(product.id)}
        className="relative z-10 -mt-14 block w-full px-5 pb-8 text-start transition-transform duration-150 ease-out-strong active:scale-[0.99]"
      >
        <span
          id="signature-title"
          className="block font-display text-[clamp(2.75rem,12.5vw,4.5rem)] leading-[0.95] tracking-[-0.01em]"
        >
          {product.name}
        </span>
        {product.description && <span className="mt-3 block max-w-[30ch] text-muted">{product.description}</span>}
        <span className="mt-4 block text-lg tabular-nums text-accent">{money(product.displayPrice)}</span>
      </button>
    </motion.section>
  );
}
