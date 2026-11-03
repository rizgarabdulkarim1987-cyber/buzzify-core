'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { MoreSheet } from './MoreSheet';
import { countText, NavIcon } from './NavIcon';
import { phActiveKey, type PhShellLink } from './nav';

const ITEM = 'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs font-semibold';

/**
 * The phone's bottom bar (below `md:`): Home, Sell, Stock, Expiry (as far as the role may use them) and "More", which
 * opens the sheet with everything else. It sits at the foot of the fixed frame, so it never scrolls with the page.
 */
export function BottomBar({
  bar,
  sheet,
  navLabel,
  moreLabel,
  closeLabel,
  account,
}: {
  bar: PhShellLink[];
  sheet: PhShellLink[];
  navLabel: string;
  moreLabel: string;
  closeLabel: string;
  account: ReactNode;
}) {
  const active = phActiveKey(usePathname());
  const [open, setOpen] = useState(false);
  const moreActive = sheet.some((l) => l.key === active);
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
              <span className={`grid place-items-center rounded-[10px] p-1 ${moreActive ? 'bg-ph-accent text-ph-g9' : ''}`}>
                <Ellipsis aria-hidden size={20} />
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
        active={active}
        title={moreLabel}
        closeLabel={closeLabel}
        account={account}
      />
    </>
  );
}
