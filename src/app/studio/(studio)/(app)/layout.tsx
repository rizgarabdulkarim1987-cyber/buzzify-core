import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getPosAccess } from '@/server/pos/actor';
import { getActor, type Actor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH } from '@/server/studio/framework/invoke';
import { activeAnnouncements } from '@/server/studio/queries/announcements';
import { myRestaurants } from '@/server/studio/queries/account';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly, posNavItem, visibleNav } from '@/studio/nav';
import { AnnouncementBar } from '@/studio/shell/AnnouncementBar';
import { BrandFooter } from '@/studio/shell/BrandFooter';
import { Sidebar, type SidebarItem } from '@/studio/shell/Sidebar';

/** The person's role as the sidebar names it: Super Admin, else their role in their restaurants. */
function roleKey(actor: Actor): string {
  if (actor.isSuperAdmin) return 'role.SUPER_ADMIN';
  return isOwnerOnly(actor) ? 'role.OWNER' : 'role.DESIGNER';
}

/**
 * Every signed-in page sits in this frame. Nobody signed in goes to sign-in; a Super Admin without two-factor goes to
 * set it up (that page is outside this layout, so the redirect cannot loop). The navigation shows only the areas the
 * person may use, in their language.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (actor.isSuperAdmin && !actor.twoFactorEnabled) redirect(TWO_FACTOR_SETUP_PATH);

  const t = getStudioTranslator(actor.locale);
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
  const items: SidebarItem[] = navItems.map(({ labelKey, label, ...item }) => ({
    ...item,
    label: label ?? t(labelKey),
  }));

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <Sidebar items={items} user={{ name: actor.name, email: actor.email, role: t(roleKey(actor)) }} />
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
