'use client';

import type { CustomerLink } from '@/server/domain/customer-links';
import { useT } from '@/studio/i18n';
import { CopyButton } from '@/studio/ui/CopyButton';

/** The Super Admin's card of addresses to send a new customer: one copy button per link, and one for the whole message. */
export function CustomerLinksCard({ links, message }: { links: CustomerLink[]; message: string }) {
  const t = useT();
  if (links.length === 0) return null;
  const labelOf = (link: CustomerLink) => (link.kind === 'menu' ? t('restaurants.links.menu', { name: link.label ?? '' }) : t(`restaurants.links.${link.kind}`));

  return (
    <section aria-labelledby="customer-links" className="flex max-w-3xl flex-col gap-3 rounded-card bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="customer-links" className="text-md font-semibold text-text">
          {t('restaurants.links.title')}
        </h2>
        <span className="rounded bg-bg-accent px-2 py-0.5 text-footnote text-accent">{t('restaurants.links.badge')}</span>
      </div>
      <p className="text-sm text-muted">{t('restaurants.links.hint')}</p>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {links.map((link) => (
          <li key={link.url} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-footnote text-muted">{labelOf(link)}</p>
              <p dir="ltr" className="truncate text-base text-text">
                {link.url}
              </p>
            </div>
            <CopyButton value={link.url} />
          </li>
        ))}
      </ul>
      {message && (
        <div className="flex justify-end">
          <CopyButton value={message} label={t('restaurants.links.copyMessage')} variant="primary" />
        </div>
      )}
    </section>
  );
}
