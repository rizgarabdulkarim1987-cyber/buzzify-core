'use client';

import { useRouter } from 'next/navigation';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { CartBar } from '@/ui/cart/CartBar';
import { BackIcon } from '@/ui/Icons';
import { ProductDetail } from './ProductDetail';

export function ProductPage({ product, view }: { product: MenuProductView; view: MenuView }) {
  const { t, href } = useApp();
  const router = useRouter();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <a href={href()} className="flex min-h-12 items-center gap-2 px-4 text-muted">
        <BackIcon />
        <span>{t('product.back')}</span>
      </a>
      <main>
        <ProductDetail
          key={product.id}
          product={product}
          mode="page"
          titleId="product-title"
          onDone={() => router.push(href())}
          onSwitch={(id) => {
            const next = view.products.find((candidate) => candidate.id === id);
            if (next) router.replace(href(`/p/${next.slug}`));
          }}
        />
      </main>
      <CartBar />
    </div>
  );
}
