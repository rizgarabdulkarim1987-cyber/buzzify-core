'use client';

import { useApp } from '@/ui/AppProviders';

export function CartBar() {
  const { itemCount, quote, quoting, money, t, href, preview } = useApp();
  if (itemCount === 0 || preview) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* data-testid="cart-bar" is also Fly to Cart's hook (template/bodies/fly-flight.ts): its flight's target and pulse. */}
      <a
        href={href('/cart')}
        data-testid="cart-bar"
        className="pointer-events-auto mx-auto flex min-h-14 w-full max-w-xl items-center justify-between rounded-full bg-accent px-6 text-on-accent shadow-[0_16px_36px_-14px_rgb(0_0_0/0.85)] transition-transform duration-150 ease-out-strong active:scale-[0.98]"
      >
        <span>{t('cart.items', { count: itemCount })}</span>
        <span className="tabular-nums" aria-live="polite">
          {quote ? money(quote.subtotal) : quoting ? t('cart.updating') : t('cart.open')}
        </span>
      </a>
    </div>
  );
}
