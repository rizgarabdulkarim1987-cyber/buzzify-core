'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SPACES, spaceOfPath, type SpaceId } from '@/studio/spaces';
import { LanguageSwitch } from './LanguageSwitch';
import { Sidebar, UserMenu, type SidebarItem, type SidebarUser } from './Sidebar';

export interface SpaceNavigation {
  id: SpaceId;
  name: string;
  items: SidebarItem[];
}

/**
 * A Super Admin's frame: the project icons alone at `/studio`, else the sidebar of the space the address belongs to.
 * It reads the address in the browser, not on the server: a layout is not drawn again when a link moves between
 * its pages, so a frame chosen on the server would stay the one of the page the person came from.
 */
export function SpaceShell({
  spaces,
  user,
  skipLabel,
  announcements,
  footer,
  children,
}: {
  spaces: readonly SpaceNavigation[];
  user: SidebarUser;
  skipLabel: string;
  announcements: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  if (pathname.replace(/\/+$/, '') === '/studio') {
    return (
      <div className="relative min-h-dvh">
        <div className="absolute end-4 top-4 z-10 flex items-center gap-3">
          <LanguageSwitch signedIn />
          <div className="w-56">
            <UserMenu user={user} />
          </div>
        </div>
        <main id="main">{children}</main>
      </div>
    );
  }

  const id = spaceOfPath(pathname, SPACES);
  const space = spaces.find((entry) => entry.id === id) ?? spaces[0]!;
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {skipLabel}
      </a>
      <Sidebar items={space.items} user={user} space={{ name: space.name, ...(space.id === 'platform' ? {} : { business: space.id }) }} />
      <div className="flex min-w-0 flex-1 flex-col">
        {announcements}
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
        {footer}
      </div>
    </div>
  );
}
