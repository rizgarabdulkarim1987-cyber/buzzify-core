import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';
import { getPosAccess } from '@/server/pos/actor';
import { getActor, type Actor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH } from '@/server/studio/framework/invoke';
import { activeAnnouncements } from '@/server/studio/queries/announcements';
import { myRestaurants } from '@/server/studio/queries/account';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly, posNavItem, spaceNav, visibleNav } from '@/studio/nav';
import { AnnouncementBar } from '@/studio/shell/AnnouncementBar';
import { BrandFooter } from '@/studio/shell/BrandFooter';
import { LanguageSwitch } from '@/studio/shell/LanguageSwitch';
import { Sidebar, UserMenu, type SidebarItem } from '@/studio/shell/Sidebar';
import { SPACES, spaceOfPath } from '@/studio/spaces';

/** The person's role as the sidebar names it: Super Admin, else their role in their restaurants. */
function roleKey(actor: Actor): string {
  if (actor.isSuperAdmin) return 'role.SUPER_ADMIN';
  return isOwnerOnly(actor) ? 'role.OWNER' : 'role.DESIGNER';
}

/**
 * Every signed-in page sits in this frame. Nobody signed in goes to sign-in; a Super Admin without two-factor goes to
 * set it up (that page is outside this layout, so the redirect cannot loop). The navigation shows only the areas the
 * person may use, in their language. A Super Admin works in closed spaces, one per project: the project icons at
 * `/studio`, and inside a space only that project's pages (`src/studio/spaces.ts`).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (actor.isSuperAdmin && !actor.twoFactorEnabled) redirect(TWO_FACTOR_SETUP_PATH);

  const t = getStudioTranslator(actor.locale);
  const user = { name: actor.name, email: actor.email, role: t(roleKey(actor)) };

  if (actor.isSuperAdmin) {
    const path = (await headers()).get(REQUEST_PATH_HEADER) ?? '/studio';
    const space = SPACES.find((entry) => entry.id === spaceOfPath(path)) ?? SPACES[0]!;
    // The project icons stand alone: no sidebar, only the language and the person's own menu in the corner.
    if (path.replace(/\/+$/, '') === '/studio') {
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

    // The Cashier item shows only to a person whose restaurant has the till open: it belongs to Menu and Cashier alone.
    const pos = space.id === 'food' ? await getPosAccess() : null;
    const navItems = pos?.actor && pos.gate?.open ? [...spaceNav(space.id), posNavItem()] : spaceNav(space.id);
    const items: SidebarItem[] = navItems.map(({ labelKey, label, scope, ...item }) => ({ ...item, label: label ?? t(labelKey) }));
    return (
      <div className="flex min-h-dvh">
        <a
          href="#main"
          className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
        >
          {t('common.skipToContent')}
        </a>
        <Sidebar items={items} user={user} space={{ name: t(space.nameKey), ...(space.id === 'platform' ? {} : { business: space.id }) }} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AnnouncementBar userId={actor.userId} initial={await query(activeAnnouncements, {})} />
          <main id="main" className="min-w-0 flex-1">
            {children}
          </main>
          <BrandFooter />
        </div>
      </div>
    );
  }

  const owned = isOwnerOnly(actor)
    ? (await query(myRestaurants, {})).map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        menuIds: restaurant.menus.map((menu) => menu.id),
      }))
    : [];
  // The Cashier item shows only to a person whose restaurant has the till open: a menu-only restaurant sees no trace of it.
  const pos = await getPosAccess();
  const navItems = pos.actor && pos.gate?.open ? [...visibleNav(actor, owned), posNavItem()] : visibleNav(actor, owned);
  const items: SidebarItem[] = navItems.map(({ labelKey, label, scope, ...item }) => ({
    ...item,
    label: label ?? (scope ? `${t(labelKey)} · ${scope}` : t(labelKey)),
  }));

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <Sidebar items={items} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AnnouncementBar userId={actor.userId} initial={await query(activeAnnouncements, {})} />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
        <BrandFooter />
      </div>
    </div>
  );
}
