'use client';

import { ChevronDown, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { countText, NavIcon } from './NavIcon';
import { phActiveKey, type PhShellLink } from './nav';

/**
 * The desktop rail's places (`md:` and up; the phone uses the bottom bar). The current place is a white pill with the
 * amber marker and `aria-current="page"`; the rest of the places sit under a native "More" toggle, closed unless the
 * current place is one of them. No motion: the toggle opens and closes at once.
 */
export function Rail({ primary, more, navLabel, moreLabel }: { primary: PhShellLink[]; more: PhShellLink[]; navLabel: string; moreLabel: string }) {
  const active = phActiveKey(usePathname());
  const moreActive = more.some((l) => l.key === active);
  return (
    <nav aria-label={navLabel} className="hidden md:flex md:flex-col md:gap-1">
      <ul className="flex flex-col gap-1">
        {primary.map((l) => (
          <li key={l.key}>
            <RailLink link={l} current={l.key === active} />
          </li>
        ))}
      </ul>
      {more.length > 0 ? (
        <details open={moreActive} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-[14px] px-3 text-sm font-medium text-ph-on-green hover:bg-ph-g8 [&::-webkit-details-marker]:hidden">
            <Ellipsis aria-hidden size={20} className="shrink-0" />
            <span className="min-w-0 flex-1 break-words">{moreLabel}</span>
            <ChevronDown aria-hidden size={16} className="shrink-0 group-open:rotate-180" />
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {more.map((l) => (
              <li key={l.key}>
                <RailLink link={l} current={l.key === active} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}

function RailLink({ link, current }: { link: PhShellLink; current: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={current ? 'page' : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-[14px] px-3 py-1.5 text-sm ${
        current ? 'bg-ph-card font-bold text-ph-g8' : 'font-medium text-ph-on-green hover:bg-ph-g8'
      }`}
    >
      <NavIcon name={link.icon} className="shrink-0" />
      <span className="min-w-0 flex-1 break-words">{link.label}</span>
      {link.count ? (
        <span className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-ph-badge px-1.5 text-xs font-bold text-ph-badge-ink">
          {countText(link.count)}
        </span>
      ) : null}
      {current ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-ph-accent" /> : null}
    </Link>
  );
}
