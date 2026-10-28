'use client';

import Link from 'next/link';
import { useApp } from '@/ui/AppProviders';
import { CompassIcon } from '@/ui/Icons';

/** The header entry to the restaurant's own page, titled in the restaurant's words (or "Explore"). Absent while the tab is off. */
export function AboutLink() {
  const { tenant, locale, href, t } = useApp();
  if (!tenant.extras.about) return null;
  const title = tenant.extras.aboutTitle[locale].trim() || t('about.title');

  return (
    <Link
      href={href('/about')}
      aria-label={title}
      title={title}
      data-testid="about-link"
      className="grid min-h-11 min-w-11 place-items-center text-muted transition-colors duration-150 [@media(hover:hover)]:hover:text-text"
    >
      <CompassIcon className="size-5" />
    </Link>
  );
}
