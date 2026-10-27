'use client';

import { useSyncExternalStore } from 'react';
import { localDigits } from '@/lib/digits';
import { DIETARY_TAGS, type DietaryTag } from '@/lib/product-tags';
import type { BusinessInfo, LocalText, Promotion } from '@/lib/templates/types';
import type { MenuOfferView } from '@/server/data/menu-view';
import { DAYS } from '@/server/domain/restaurant-profile';
import { useApp } from '@/ui/AppProviders';
import { CameraIcon, ChatIcon, ClockIcon, CloseIcon, GlobeIcon, PauseIcon, PhoneIcon, PinIcon, PlayIcon, SearchIcon } from '@/ui/Icons';
import { GuestTools } from '@/ui/guest/GuestTools';
import { useOfferEnd } from '@/ui/menu/SalesLabels';

/** The pieces around a template menu's products: header, search, filters, an offer, the place's details, the footer. */

export function TemplateHeader() {
  const { tenant, table, t, href } = useApp();
  return (
    <header className="tpl-header flex items-start justify-between gap-4 px-(--gutter)">
      <div className="min-w-0">
        <h1 className="tpl-brand tpl-display">
          <a href={href()} data-testid="brand" className="flex min-h-11 items-center">
            {tenant.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logo.url}
                alt={tenant.logoText}
                width={tenant.logo.width}
                height={tenant.logo.height}
                className="h-10 w-auto max-w-[14rem] object-contain object-left rtl:object-right"
              />
            ) : (
              tenant.logoText
            )}
          </a>
        </h1>
        {table !== null && <p className="mt-0.5 text-sm text-(--accent-ink)">{t('menu.table', { number: String(table).padStart(2, '0') })}</p>}
      </div>
      <GuestTools />
    </header>
  );
}

export function SearchField({ query, onQuery, onFocus }: { query: string; onQuery: (value: string) => void; onFocus: () => void }) {
  const { t } = useApp();
  return (
    <div className="px-(--gutter)">
      <label className="tpl-search relative block">
        <span className="sr-only">{t('menu.search')}</span>
        <SearchIcon className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-(--muted)" />
        <input
          type="search"
          role="searchbox"
          aria-label={t('menu.search')}
          value={query}
          onFocus={onFocus}
          onChange={(event) => {
            onFocus();
            onQuery(event.target.value);
          }}
          placeholder={t('menu.searchPlaceholder')}
          className="tpl-search-input"
        />
        {query !== '' && (
          <button type="button" aria-label={t('menu.clearSearch')} onClick={() => onQuery('')} className="absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center text-(--muted)">
            <CloseIcon />
          </button>
        )}
      </label>
    </div>
  );
}

/**
 * Dietary filters, only for the tags the menu's products actually carry, and the guest's favourites once there are any.
 * A filter shows products with every chosen tag.
 */
export function FilterBar({
  available,
  chosen,
  onToggle,
  favorites,
  favoritesOnly,
  onFavorites,
  onClear,
}: {
  available: ReadonlySet<DietaryTag>;
  chosen: ReadonlySet<DietaryTag>;
  onToggle: (tag: DietaryTag) => void;
  favorites: number;
  favoritesOnly: boolean;
  onFavorites: () => void;
  onClear: () => void;
}) {
  const { t } = useApp();
  if (available.size === 0 && favorites === 0) return null;
  const active = chosen.size > 0 || favoritesOnly;
  return (
    <div role="group" aria-label={t('tpl.filters')} className="scroll-hidden flex gap-2 overflow-x-auto px-(--gutter)">
      {favorites > 0 && (
        <button type="button" aria-pressed={favoritesOnly} onClick={onFavorites} className="tpl-chip tpl-filter shrink-0">
          {t('tpl.favorites')}
          <span className="tabular-nums">{favorites}</span>
        </button>
      )}
      {DIETARY_TAGS.filter((tag) => available.has(tag)).map((tag) => (
        <button key={tag} type="button" aria-pressed={chosen.has(tag)} onClick={() => onToggle(tag)} className="tpl-chip tpl-filter shrink-0">
          {t(`menu.dietary.${tag}`)}
        </button>
      ))}
      {active && (
        <button type="button" onClick={onClear} className="tpl-chip tpl-chip-quiet shrink-0">
          {t('tpl.clearFilters')}
        </button>
      )}
    </div>
  );
}

function pick(text: LocalText | undefined, locale: string, fallback: string): string {
  if (!text) return '';
  return text[locale as keyof LocalText] ?? text[fallback as keyof LocalText] ?? Object.values(text)[0] ?? '';
}

/** The business's offer, always with its terms beside it. */
export function PromoCard({ promo }: { promo: Promotion }) {
  const { t, locale, tenant } = useApp();
  const title = pick(promo.title, locale, tenant.defaultLocale);
  const terms = pick(promo.terms, locale, tenant.defaultLocale);
  const body = pick(promo.body, locale, tenant.defaultLocale);
  if (!title || !terms) return null;
  return (
    <section aria-labelledby="tpl-offer" className="px-(--gutter)">
      <div className="tpl-promo">
        <h2 id="tpl-offer" className="tpl-display tpl-name-lg">
          {title}
        </h2>
        {body && <p className="mt-1.5 max-w-[48ch] text-(--muted)">{body}</p>}
        <p className="mt-3 text-sm text-(--muted)">{t('tpl.offerTerms', { terms })}</p>
      </div>
    </section>
  );
}

/** The live offers from the Sales tab (specials and discounts), each with when it ends, in the template's own voice. */
export function OfferList({ offers }: { offers: MenuOfferView[] }) {
  const { t, tenant } = useApp();
  const endOf = useOfferEnd();
  if (offers.length === 0) return null;
  return (
    <section aria-label={t('offers.label')} className="px-(--gutter)">
      <ul className="tpl-offers">
        {offers.map((offer) => {
          const ends = endOf(offer);
          return (
            <li key={offer.id} className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="tpl-display tpl-name">{offer.title}</span>
                  {offer.percentOff !== null && (
                    <span className="tpl-badge tpl-badge-sale tabular-nums">
                      {t('menu.percentOff', { percent: localDigits(String(offer.percentOff), tenant.numeralSystem) })}
                    </span>
                  )}
                </p>
                {offer.text && <p className="mt-1 max-w-[48ch] text-sm text-(--muted)">{offer.text}</p>}
              </div>
              {ends && <p className="shrink-0 text-sm tabular-nums text-(--muted)">{ends}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The day of the week on the guest's device, read after hydration (the server cannot know it).
const noSubscription = () => () => {};
const todayIndex = () => (new Date().getDay() + 6) % 7;
const noDay = () => -1;

function whatsappLink(number: string): string {
  return `https://wa.me/${number.replace(/[^0-9]/g, '')}`;
}

/** The place's details the business chose to show: hours, address and map, phone, WhatsApp, social links. */
export function InfoSection({ info }: { info: BusinessInfo }) {
  const { t } = useApp();
  const today = useSyncExternalStore(noSubscription, todayIndex, noDay);
  const social = info.social ? (Object.entries(info.social) as Array<[keyof NonNullable<BusinessInfo['social']>, string]>) : [];
  if (!info.hours && !info.address && !info.mapUrl && !info.phone && !info.whatsapp && social.length === 0) return null;

  return (
    <section aria-labelledby="tpl-info" className="tpl-info px-(--gutter)">
      <h2 id="tpl-info" className="tpl-h2 tpl-display">
        {t('tpl.info')}
      </h2>
      <div className="mt-5 grid gap-8 md:grid-cols-2">
        {info.hours && (
          <div>
            <h3 className="flex items-center gap-2 text-sm text-(--muted)">
              <ClockIcon className="size-4" />
              {t('tpl.hours')}
            </h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              {DAYS.map((day, index) => {
                const ranges = info.hours?.[day] ?? [];
                const isToday = index === today;
                return (
                  <div key={day} className={`contents ${isToday ? 'font-medium text-(--text)' : 'text-(--muted)'}`}>
                    <dt>
                      {t(`tpl.day.${day}`)}
                      {isToday && <span className="sr-only"> ({t('tpl.today')})</span>}
                    </dt>
                    <dd dir="ltr" className="text-end tabular-nums rtl:text-start">
                      {ranges.length === 0 ? t('tpl.closed') : ranges.map(([open, close]) => `${open}–${close}`).join(', ')}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
        <ul className="grid content-start gap-2">
          {info.address && (
            <li className="flex items-start gap-3">
              <PinIcon className="mt-0.5 size-5 shrink-0 text-(--muted)" />
              <span className="min-w-0">
                <span className="sr-only">{t('tpl.address')}: </span>
                {info.address}
                {info.mapUrl && (
                  <a href={info.mapUrl} target="_blank" rel="noopener noreferrer" className="tpl-link mt-1 block w-fit">
                    {t('tpl.map')}
                  </a>
                )}
              </span>
            </li>
          )}
          {!info.address && info.mapUrl && (
            <li>
              <a href={info.mapUrl} target="_blank" rel="noopener noreferrer" className="tpl-contact">
                <PinIcon className="size-5" />
                {t('tpl.map')}
              </a>
            </li>
          )}
          {info.phone && (
            <li>
              <a href={`tel:${info.phone.replace(/[^0-9+]/g, '')}`} className="tpl-contact" aria-label={t('tpl.call', { phone: info.phone })}>
                <PhoneIcon className="size-5" />
                <bdi dir="ltr" className="tabular-nums">
                  {info.phone}
                </bdi>
              </a>
            </li>
          )}
          {info.whatsapp && (
            <li>
              <a href={whatsappLink(info.whatsapp)} target="_blank" rel="noopener noreferrer" className="tpl-contact">
                <ChatIcon className="size-5" />
                {t('tpl.whatsapp')}
              </a>
            </li>
          )}
          {social.length > 0 && (
            <li className="flex flex-wrap gap-2 pt-2">
              {social.map(([network, url]) => (
                <a key={network} href={url} target="_blank" rel="noopener noreferrer" className="tpl-chip" aria-label={t(`tpl.social.${network}`)}>
                  {network === 'website' ? <GlobeIcon className="size-4" /> : <CameraIcon className="size-4" />}
                  {t(`tpl.social.${network}`)}
                </a>
              ))}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

export function TemplateFooter({ poweredBy, motion }: { poweredBy: boolean; motion: { paused: boolean; toggle: () => void } | null }) {
  const { t } = useApp();
  if (!poweredBy && !motion) return null;
  return (
    <footer className="tpl-footer flex flex-wrap items-center justify-between gap-4 px-(--gutter)">
      {motion ? (
        <button type="button" onClick={motion.toggle} aria-pressed={motion.paused} className="tpl-chip tpl-chip-quiet">
          {motion.paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
          {t(motion.paused ? 'tpl.playMotion' : 'tpl.pauseMotion')}
        </button>
      ) : (
        <span />
      )}
      {poweredBy && (
        <a href="https://buzzify.me" target="_blank" rel="noopener" className="text-sm text-(--muted) underline-offset-4 hover:underline">
          {t('tpl.poweredBy')}
        </a>
      )}
    </footer>
  );
}
