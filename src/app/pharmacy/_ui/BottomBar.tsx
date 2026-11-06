'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { MoreSheet } from './MoreSheet';
import { countText, NavIcon } from './NavIcon';
import { phActiveKey, type PhShellGroup, type PhShellLink } from './nav';

/** Tailwind's `md:` breakpoint, where the rail takes over from the bottom bar. */
const DESKTOP = '(min-width: 48rem)';

const ITEM = 'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs font-semibold';

/**
 * The phone's bottom bar (below `md:`): Sell, Stock, Products, Customers (as far as the role may use them) and "More",
 * which opens the sheet with everything else (Reports, the AI Doctor, then the grouped places). It sits at the foot of the fixed frame, so it never scrolls with the page.
 */
export function BottomBar({
  bar,
  sheet,
  groups,
  moreCount = 0,
  navLabel,
  moreLabel,
  closeLabel,
  account,
}: {
  bar: PhShellLink[];
  /** Primary places the bar has no room for (Reports, the AI Doctor); they lead the sheet. */
  sheet: PhShellLink[];
  groups: PhShellGroup[];
  /** A counter hidden inside the sheet (expiry), drawn on the More button. */
  moreCount?: number;
  navLabel: string;
  moreLabel: string;
  closeLabel: string;
  account: ReactNode;
}) {
  const active = phActiveKey(usePathname());
  const [open, setOpen] = useState(false);
  // The sheet is a phone-only modal: once the window widens past `md:` (a tablet turned on its side) it is hidden but would
  // still hold the page inert, so it closes.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);
  const moreActive = [...sheet, ...groups.flatMap((g) => g.links)].some((l) => l.key === active);
  return (
    <>
      <nav aria-label={navLabel} className="shrink-0 bg-ph-g9 pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        <ul className="grid auto-cols-fr grid-flow-col">
          {bar.map((l) => {
            const current = l.key === active;
            return (
              <li key={l.key} className="min-w-0">
                <Link
                  href={l.href}
                  aria-current={current ? 'page' : undefined}
                  className={`${ITEM} ${current ? 'text-ph-on-green' : 'text-ph-on-green-muted'}`}
                >
                  <span className="relative">
                    <span className={`grid place-items-center rounded-[10px] p-1 ${current ? 'bg-ph-accent text-ph-g9' : ''}`}>
                      <NavIcon name={l.icon} />
                    </span>
                    {l.count ? (
                      <span className="absolute -top-1.5 start-5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ph-badge px-1 text-[11px] font-bold leading-none text-ph-badge-ink">
                        {countText(l.count)}
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-full truncate">{l.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls="ph-more-sheet"
              aria-current={moreActive ? 'page' : undefined}
              onClick={() => setOpen(true)}
              className={`${ITEM} ${moreActive ? 'text-ph-on-green' : 'text-ph-on-green-muted'}`}
            >
              <span className="relative">
                <span className={`grid place-items-center rounded-[10px] p-1 ${moreActive ? 'bg-ph-accent text-ph-g9' : ''}`}>
                  <Ellipsis aria-hidden size={20} />
                </span>
                {moreCount ? (
                  <span className="absolute -top-1.5 start-5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ph-badge px-1 text-[11px] font-bold leading-none text-ph-badge-ink">
                    {countText(moreCount)}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{moreLabel}</span>
            </button>
          </li>
        </ul>
      </nav>
      <MoreSheet
        open={open}
        onClose={() => setOpen(false)}
        links={sheet}
        groups={groups}
        active={active}
        title={moreLabel}
        closeLabel={closeLabel}
        account={account}
      />
    </>
  );
}
