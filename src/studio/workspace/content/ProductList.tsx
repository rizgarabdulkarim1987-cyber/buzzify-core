'use client';

import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Sparkles, Star, Trash2, UtensilsCrossed } from 'lucide-react';
import type { Locale } from '@/lib/locale';
import type { ContentTree } from '@/server/studio/services/content';
import { useLocale, useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/studio/ui/DropdownMenu';
import { IconButton } from '@/studio/ui/IconButton';
import { displayName, formatMoney } from './shared';

export type ProductRow = ContentTree['categories'][number]['products'][number];

/** The languages a text is missing in, as a quiet marker: what guests reading those languages would not see. */
export function MissingMarker({ missing }: { missing: readonly Locale[] }) {
  const t = useT();
  if (missing.length === 0) return null;
  const languages = missing.map((code) => t(`menus.language.${code}`)).join(t('content.listSeparator'));
  return <span className="rounded-sm bg-accent-wash px-1.5 py-px text-xs text-text">{t('content.missingIn', { languages })}</span>;
}

export interface ProductListProps {
  products: ProductRow[];
  currency: string;
  defaultLocale: Locale;
  busy: boolean;
  onOpen: (product: ProductRow) => void;
  onMove: (product: ProductRow, index: number) => void;
  onDelete: (product: ProductRow) => void;
}

/** A category's products in their order: each opens in the drawer, and its menu moves or deletes it. */
export function ProductList({ products, currency, defaultLocale, busy, onOpen, onMove, onDelete }: ProductListProps) {
  const t = useT();
  const { locale } = useLocale();

  if (products.length === 0) return <p className="px-4 py-4 text-sm text-muted">{t('content.noProducts')}</p>;

  return (
    <ul className="divide-y divide-line">
      {products.map((product, index) => {
        const name = displayName(product.names, locale, defaultLocale) || product.slug;
        return (
          <li key={product.id} className="relative flex items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-hover">
            <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface">
              {product.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail, already sized
                <img src={product.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
              ) : (
                <UtensilsCrossed aria-hidden className="size-4 text-muted" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <button
                type="button"
                onClick={() => onOpen(product)}
                className="min-w-0 truncate text-start text-base font-medium text-text after:absolute after:inset-0 after:content-['']"
              >
                {name}
              </button>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                {product.isSignature && (
                  <span className="inline-flex items-center gap-1">
                    <Star aria-hidden className="size-3.5" />
                    {t('content.signature')}
                  </span>
                )}
                {product.isFeatured && (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles aria-hidden className="size-3.5" />
                    {t('content.featured')}
                  </span>
                )}
                {product.badges.map((badge) => (
                  <span key={badge} className="rounded-sm border border-line px-1.5 text-xs text-text">
                    {t(`content.badge.${badge}`)}
                  </span>
                ))}
                {!product.isAvailable && <span className="text-danger">{t('content.soldOut')}</span>}
                {product.isHidden && <span>{t('content.hidden')}</span>}
                <MissingMarker missing={product.missing} />
              </div>
            </div>
            <span dir="ltr" className={cx('shrink-0 text-base tabular-nums text-text', product.price === 0 && 'text-muted')}>
              {formatMoney(product.price, currency, locale)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={t('content.productActions', { name })} icon={<MoreHorizontal aria-hidden />} size="sm" className="relative z-10" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => onOpen(product)}>
                  {t('content.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem icon={<ArrowUp aria-hidden />} disabled={index === 0 || busy} onSelect={() => onMove(product, index - 1)}>
                  {t('content.moveUp')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<ArrowDown aria-hidden />}
                  disabled={index === products.length - 1 || busy}
                  onSelect={() => onMove(product, index + 1)}
                >
                  {t('content.moveDown')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => onDelete(product)}>
                  {t('content.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}
