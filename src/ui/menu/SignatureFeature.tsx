'use client';

import { useEffect, useRef } from 'react';
import { stageTone } from '@/lib/stage';
import type { MenuProductView } from '@/server/data/menu-view';
import type { Daypart } from '@/server/domain/types';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { ProductStage } from '@/ui/stage/ProductStage';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';

/** Scroll distance over which the hero stage drifts and dims, and how far it goes. */
const DRIFT_RANGE_PX = 420;
const DRIFT_DISTANCE_PX = 56;
const DIM_TO = 0.3;

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
  const { t, money, tenant } = useApp();
  // The 3D dish is the plan's to give; without it the dish art is shown, as on a device without WebGL.
  const staged = tenant.features.stage && stageTone(product.media) !== null;
  const reduced = usePrefersReducedMotion();
  const stage = useRef<HTMLDivElement>(null);

  // The lit stage drifts down and dims a little as the menu scrolls over it, which gives the page depth.
  // Written straight to the element on animation frames; with reduced motion it stays put. Hydration renders
  // with reduced motion off (the server cannot know), so the cleanup puts the stage back at rest when the
  // preference arrives after a scroll has already moved it.
  useEffect(() => {
    const element = stage.current;
    if (!element || reduced) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const progress = Math.min(Math.max(window.scrollY / DRIFT_RANGE_PX, 0), 1);
      element.style.transform = progress === 0 ? '' : `translateY(${progress * DRIFT_DISTANCE_PX}px)`;
      element.style.opacity = progress === 0 ? '' : String(1 - progress * (1 - DIM_TO));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      element.style.transform = '';
      element.style.opacity = '';
    };
  }, [reduced]);

  return (
    <section aria-labelledby="signature-title" className="rise-in pt-3">
      <p className="px-5 text-sm text-muted">{t(`signature.${daypart ?? 'NONE'}`)}</p>
      <div
        ref={stage}
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
    </section>
  );
}
