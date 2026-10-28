'use client';

import Link from 'next/link';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { WheelDisc } from './WheelDisc';
import { useWheel, type WheelData, type WheelPhase, type WheelResult } from './useWheel';

const BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 text-base font-medium text-on-accent transition-opacity duration-150 disabled:opacity-60 [@media(hover:hover)]:hover:opacity-90';

export interface WheelViewProps {
  title: string;
  state: WheelData;
  phase: WheelPhase;
  rotation: number;
  result: WheelResult | null;
  reduced: boolean;
  onSpin(): void;
  onAgain(): void;
}

/** The wheel's markup, given its state: the page's own section, never a popup. Drawn by `WheelSection`; separate so it can be rendered in any state. */
export function WheelView({ title, state, phase, rotation, result, reduced, onSpin, onAgain }: WheelViewProps) {
  const { t, href, price } = useApp();
  if (state.status === 'unavailable') return null;

  return (
    <section data-testid="wheel" aria-labelledby="wheel-title" className="flex flex-col gap-4">
      <h3 id="wheel-title" className="break-words font-display text-2xl">
        {title}
      </h3>

      {state.status === 'loading' && <div aria-hidden className="mx-auto aspect-square w-full max-w-[22rem] rounded-full bg-raised" />}

      {state.status === 'ready' && phase !== 'result' && (
        <>
          <WheelDisc slices={state.slices} rotation={rotation} spinning={phase === 'spinning'} reduced={reduced} />
          {state.spinsLeft > 0 ? (
            <button type="button" onClick={onSpin} disabled={phase === 'spinning'} className={`${BUTTON} mx-auto`}>
              {reduced ? t('wheel.reveal') : t('wheel.spin')}
            </button>
          ) : (
            <p role="status" className="text-center text-muted">
              {t('wheel.usedToday')}
            </p>
          )}
        </>
      )}

      {state.status === 'ready' && phase === 'result' && result && (
        <div role="status" className="flex flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-raised pb-4">
          <ProductVisual
            media={[{ kind: 'image', url: result.slice.photo.url, alt: result.slice.name, width: result.slice.photo.width, height: result.slice.photo.height }]}
            name={result.slice.name}
            slug={`wheel-${result.slice.productId}`}
            priority
            className="aspect-[4/3] w-full"
            sizes="(min-width: 672px) 640px, 100vw"
          />
          <div className="flex flex-col gap-1 px-4">
            <span className="text-sm text-muted">{t('wheel.result')}</span>
            <span className="break-words font-display text-2xl">{result.slice.name}</span>
            <span className="font-medium">{price(result.slice.price)}</span>
            {result.label && <span className="mt-1 w-fit rounded-full bg-accent px-3 py-1 text-sm font-medium text-on-accent">{result.label}</span>}
          </div>
          <div className="flex flex-wrap gap-2 px-4">
            <Link href={href(`/p/${result.slice.slug}`)} className={BUTTON}>
              {t('wheel.order')}
            </Link>
            {state.spinsLeft > 0 && (
              <button type="button" onClick={onAgain} className={`${BUTTON} !bg-transparent !text-text border border-line`}>
                {t('wheel.again')}
              </button>
            )}
          </div>
          {state.spinsLeft < 1 && <p className="px-4 text-sm text-muted">{t('wheel.usedToday')}</p>}
        </div>
      )}
    </section>
  );
}

/** The wheel inside the Explore page: loads its own state from the spin route. */
export function WheelSection({ title }: { title: string }) {
  const wheel = useWheel();
  return <WheelView title={title} state={wheel.state} phase={wheel.phase} rotation={wheel.rotation} result={wheel.result} reduced={wheel.reduced} onSpin={wheel.spin} onAgain={wheel.again} />;
}
