'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

const BASE = 'inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap [&_svg]:size-4 [&_svg]:shrink-0';
const IDLE = 'text-muted hover:bg-hover hover:text-text';
// The one use of the accent the Studio allows besides selection and focus: the current navigation item.
const CURRENT = 'bg-accent-wash text-text shadow-[inset_0_-2px_0_var(--color-accent)]';

/**
 * One link of the pharmacy's navigation. The current page is marked with `aria-current` and the accent wash, so it
 * does not depend on colour alone. `exact` keeps a section's own link from also lighting on its sub-pages (Stock and
 * Stock > Expiry).
 */
export function NavLink({ href, icon, exact = false, children }: { href: string; icon: ReactNode; exact?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || (!exact && pathname.startsWith(`${href}/`));
  const link = useRef<HTMLAnchorElement>(null);
  // On a phone the row scrolls: bring the current page's link into view.
  useEffect(() => {
    if (current) link.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [current]);
  return (
    <Link ref={link} href={href} aria-current={current ? 'page' : undefined} className={`${BASE} ${current ? CURRENT : IDLE}`}>
      {icon}
      {children}
    </Link>
  );
}
