'use client';

import Link from 'next/link';
import { localDigits } from '@/lib/digits';
import type { AboutOfferView } from '@/server/data/about';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { useApp } from '@/ui/AppProviders';

/** A day, month and year with no month names, so it reads the same in every language, in the menu's numerals and time zone. */
export function offerDate(date: Date, timeZone: string, numerals: 'latn' | 'arab'): string {
  const text = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  return localDigits(text, numerals);
}

/** One offer: its picture, a label chip (a price or a percentage), the words, the last day, and a link to the dish or category when it has one. */
export function OfferCard({ offer, timeZone }: { offer: AboutOfferView; timeZone: string }) {
  const { t, href, tenant } = useApp();
  const target = offer.link ? (offer.link.kind === 'product' ? href(`/p/${offer.link.slug}`) : `${href()}#cat-${offer.link.slug}`) : null;
  const body = (
    <>
      {offer.image && (
        <span className="relative block">
          <ProductVisual media={[offer.image]} name={offer.image.alt || offer.title} slug={offer.id} className="aspect-[16/9] w-full" sizes="(min-width: 672px) 640px, 100vw" />
          {offer.label && (
            <span className="absolute start-3 top-3 rounded-full bg-accent px-3 py-1 text-sm font-medium text-on-accent">{offer.label}</span>
          )}
        </span>
      )}
      <span className="flex flex-col gap-1 p-4">
        {!offer.image && offer.label && (
          <span className="w-fit rounded-full bg-accent px-3 py-1 text-sm font-medium text-on-accent">{offer.label}</span>
        )}
        {offer.title && <span className="break-words font-display text-xl">{offer.title}</span>}
        {offer.body && <span className="break-words text-muted">{offer.body}</span>}
        {offer.until && (
          <span className="mt-1 text-sm text-muted">{t('about.until', { date: offerDate(offer.until, timeZone, tenant.numeralSystem) })}</span>
        )}
        {target && <span className="mt-2 text-sm font-medium text-accent">{t('about.open')}</span>}
      </span>
    </>
  );
  const frame = 'block overflow-hidden rounded-2xl border border-line bg-raised';
  return target ? (
    <Link href={target} className={`${frame} transition-colors duration-150 [@media(hover:hover)]:hover:border-accent`}>
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}
