'use client';

import { direction } from '@/lib/locale';
import type { AboutView } from '@/server/data/about';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { useApp } from '@/ui/AppProviders';
import { CartBar } from '@/ui/cart/CartBar';
import { ClockIcon, PhoneIcon, PinIcon } from '@/ui/Icons';
import { Header } from '@/ui/menu/Header';
import { HoursTable } from './HoursTable';
import { OfferCard } from './OfferCard';
import { StoryBlocks } from './StoryBlocks';
import { WheelSection } from '@/ui/wheel/WheelSection';

const ACTION =
  'inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm transition-colors duration-150 [@media(hover:hover)]:hover:border-accent';

/** The restaurant's own page inside the menu: cover, story, offers, hours and contact, gallery. A part with nothing in it is not drawn. */
export function AboutPage({ view }: { view: AboutView }) {
  const { t, locale } = useApp();
  const social = Object.entries(view.contacts.social ?? {}) as [string, string][];
  const hasContact = Boolean(view.address || view.contacts.phone || view.contacts.whatsapp || view.contacts.mapUrl || social.length > 0);
  const whatsapp = view.contacts.whatsapp?.replace(/[^0-9]/g, '');

  return (
    <div dir={direction(locale)} className="mx-auto min-h-dvh max-w-2xl pb-28">
      <Header />
      <main className="flex flex-col gap-10 px-5 pt-4">
        {view.cover && (
          <ProductVisual media={[view.cover]} name={view.cover.alt || view.title} slug="about-cover" priority className="aspect-[16/9] w-full rounded-2xl" sizes="(min-width: 672px) 640px, 100vw" />
        )}
        <h2 className="break-words font-display text-4xl tracking-[-0.005em]">{view.title}</h2>

        {view.story.length > 0 && <StoryBlocks blocks={view.story} />}

        {view.wheel && <WheelSection title={view.wheel.title} />}

        {view.offers.length > 0 && (
          <section aria-labelledby="about-offers" className="flex flex-col gap-4">
            <h3 id="about-offers" className="font-display text-2xl">
              {t('about.offers')}
            </h3>
            {view.offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} timeZone={view.timeZone} />
            ))}
          </section>
        )}

        {view.hours && (
          <section aria-labelledby="about-hours" className="flex flex-col gap-2">
            <h3 id="about-hours" className="flex items-center gap-2 font-display text-2xl">
              <ClockIcon className="size-5 text-muted" />
              {t('about.hours')}
            </h3>
            <HoursTable hours={view.hours} today={view.today} />
          </section>
        )}

        {hasContact && (
          <section aria-labelledby="about-contact" className="flex flex-col gap-3">
            <h3 id="about-contact" className="font-display text-2xl">
              {t('about.contact')}
            </h3>
            {view.address && (
              <p className="flex items-start gap-2 break-words text-text">
                <PinIcon className="mt-1 size-5 shrink-0 text-muted" />
                {view.address}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {view.contacts.phone && (
                <a href={`tel:${view.contacts.phone}`} className={ACTION}>
                  <PhoneIcon className="size-4" />
                  {t('about.call')}
                </a>
              )}
              {whatsapp && (
                <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className={ACTION}>
                  {t('about.whatsapp')}
                </a>
              )}
              {view.contacts.mapUrl && (
                <a href={view.contacts.mapUrl} target="_blank" rel="noopener noreferrer" className={ACTION}>
                  <PinIcon className="size-4" />
                  {t('about.map')}
                </a>
              )}
              {social.map(([name, url]) => (
                <a key={name} href={url} target="_blank" rel="noopener noreferrer" className={`${ACTION} capitalize`}>
                  {name}
                </a>
              ))}
            </div>
          </section>
        )}

        {view.gallery.length > 0 && (
          <section aria-labelledby="about-gallery" className="flex flex-col gap-3">
            <h3 id="about-gallery" className="font-display text-2xl">
              {t('about.gallery')}
            </h3>
            <ul className="grid grid-cols-2 gap-2">
              {view.gallery.map((image, index) => (
                <li key={image.assetId ?? index}>
                  <ProductVisual media={[image]} name={image.alt || view.title} slug={`about-gallery-${index}`} className="aspect-square w-full rounded-xl" sizes="(min-width: 672px) 320px, 50vw" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <CartBar />
    </div>
  );
}
