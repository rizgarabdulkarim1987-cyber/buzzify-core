'use client';

import { useMemo } from 'react';
import { lineKey } from '@/lib/cart';
import type { QuoteBundleView, QuoteLineView } from '@/server/data/quote-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { BackIcon, MinusIcon, PlusIcon } from '@/ui/Icons';
import { PairingList } from '@/ui/product/PairingList';
import { useSuggestions } from '@/ui/useSuggestions';
import { BundleSuggestion } from './BundleSuggestion';

function Stepper({
  quantity,
  name,
  onChange,
}: {
  quantity: number;
  name: string;
  onChange: (next: number) => void;
}) {
  const { t } = useApp();
  return (
    <div className="flex items-center rounded-full border border-line" role="group" aria-label={`${t('product.quantity')}: ${name}`}>
      <button type="button" aria-label={t('product.decrease')} onClick={() => onChange(quantity - 1)} className="grid size-11 place-items-center">
        <MinusIcon />
      </button>
      <output className="min-w-6 text-center tabular-nums">{quantity}</output>
      <button type="button" aria-label={t('product.increase')} onClick={() => onChange(quantity + 1)} className="grid size-11 place-items-center">
        <PlusIcon />
      </button>
    </div>
  );
}

export function CartView() {
  const {
    t,
    money,
    href,
    cart,
    quote,
    quoting,
    quoteError,
    hydrated,
    setQuantity,
    removeLine,
    setBundleQuantity,
    replaceCart,
    addLine,
    announce,
    dismissed,
    dismiss,
  } = useApp();

  const body = useMemo(
    () => (hydrated && (cart.lines.length > 0 || cart.bundles.length > 0) ? { context: 'cart' as const, cart, dismissedIds: dismissed } : null),
    [hydrated, cart, dismissed],
  );
  const { data } = useSuggestions(body);

  const empty = hydrated && cart.lines.length === 0 && cart.bundles.length === 0;
  const issueText = (line: QuoteLineView | QuoteBundleView) =>
    line.issues.map((issue) => t(`issue.${issue.code}`)).filter((text, index, all) => all.indexOf(text) === index);
  const hasIssues = (quote?.hasBlockingIssues ?? false) && !quoting;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-16">
      <a href={href()} className="flex min-h-12 items-center gap-2 text-muted">
        <BackIcon />
        <span>{t('cart.back')}</span>
      </a>
      <h1 className="mt-2 font-display text-3xl">{t('cart.title')}</h1>

      {empty && (
        <div className="py-16 text-center">
          <p className="font-display text-2xl">{t('cart.empty')}</p>
          <p className="mt-2 text-muted">{t('cart.emptyHint')}</p>
        </div>
      )}

      {!empty && (
        <>
          <ul className="mt-4">
            {(quote?.lines ?? []).map((line) => {
              const source = cart.lines[line.index];
              if (!source) return null;
              const key = lineKey(source);
              const title = line.name || t('issue.UNKNOWN_PRODUCT');
              const issues = issueText(line).filter((text) => text !== title);
              return (
                <li key={`${key}-${line.index}`} data-testid="cart-line" className="border-b border-line py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-lg">{title}</p>
                      {(line.variantName || line.optionNames.length > 0) && (
                        <p className="text-sm text-muted">
                          {[line.variantName, ...line.optionNames].filter(Boolean).join(', ')}
                        </p>
                      )}
                      {issues.map((text) => (
                        <p key={text} className="text-sm text-accent">
                          {text}
                        </p>
                      ))}
                    </div>
                    <p className="shrink-0 tabular-nums">{money(line.lineTotal)}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Stepper
                      quantity={source.quantity}
                      name={title}
                      onChange={(next) => setQuantity(key, next)}
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(key)}
                      aria-label={line.name ? t('cart.removeNamed', { name: line.name }) : t('cart.remove')}
                      className="min-h-11 px-3 text-sm text-muted underline underline-offset-4"
                    >
                      {t('cart.remove')}
                    </button>
                  </div>
                </li>
              );
            })}

            {(quote?.bundles ?? []).map((line) => {
              const source = cart.bundles[line.index];
              if (!source) return null;
              const issues = issueText(line);
              return (
                <li key={`bundle-${line.bundleId}`} data-testid="cart-line" className="border-b border-line py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-lg">{line.name || t('issue.UNKNOWN_BUNDLE')}</p>
                      {line.savings > 0 && issues.length === 0 && (
                        <p className="text-sm text-muted">{t('bundle.save', { amount: money(line.savings * line.quantity) })}</p>
                      )}
                      {issues.map((text) => (
                        <p key={text} className="text-sm text-accent">
                          {text}
                        </p>
                      ))}
                    </div>
                    <p className="shrink-0 tabular-nums">{money(line.lineTotal)}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Stepper
                      quantity={source.quantity}
                      name={line.name}
                      onChange={(next) => setBundleQuantity(source.bundleId, next)}
                    />
                    <button
                      type="button"
                      onClick={() => setBundleQuantity(source.bundleId, 0)}
                      aria-label={t('cart.removeNamed', { name: line.name })}
                      className="min-h-11 px-3 text-sm text-muted underline underline-offset-4"
                    >
                      {t('cart.remove')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {quoteError && <p className="mt-4 text-sm text-accent">{t('cart.quoteError')}</p>}

          {data?.bundles[0] && (
            <BundleSuggestion
              bundle={data.bundles[0]}
              onApply={(bundle) => {
                replaceCart(bundle.cartAfter);
                announce(bundle.name);
              }}
            />
          )}

          <PairingList
            offers={data?.pairings ?? []}
            onAdd={(offer) => {
              addLine({ productId: offer.productId, variantId: null, optionIds: [], quantity: 1 });
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              announce(t('cart.added', { name: offer.name }));
            }}
            onChoose={(offer) => {
              // Opening the dish to choose is not adding it: only a real add counts toward what guests take.
              window.location.assign(href(`/p/${offer.slug}`));
            }}
            onDismiss={(offer) => dismiss(offer.suggestionId)}
          />

          <PairingList
            offers={data?.meal ?? []}
            title={t('meal.title')}
            headingId="meal-title"
            onAdd={(offer) => {
              addLine({ productId: offer.productId, variantId: null, optionIds: [], quantity: 1 });
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              announce(t('cart.added', { name: offer.name }));
            }}
            onChoose={(offer) => {
              // Opening the dish to choose is not adding it: only a real add counts toward what guests take.
              window.location.assign(href(`/p/${offer.slug}`));
            }}
            onDismiss={(offer) => dismiss(offer.suggestionId)}
          />

          <section className="mt-8 border-t border-line pt-4" aria-labelledby="review-title">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-xl">{t('cart.subtotal')}</h2>
              <p data-testid="cart-subtotal" className="text-xl tabular-nums" aria-live="polite">
                {quote ? money(quote.subtotal) : t('cart.updating')}
              </p>
            </div>
            {hasIssues && <p className="mt-2 text-sm text-accent">{t('cart.fixIssues')}</p>}
            <h3 id="review-title" className="mt-8 font-display text-lg">
              {t('cart.reviewTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted">{t('cart.reviewNote')}</p>
          </section>
        </>
      )}
    </main>
  );
}
