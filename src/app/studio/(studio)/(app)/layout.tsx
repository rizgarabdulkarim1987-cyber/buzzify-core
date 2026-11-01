import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getPosAccess } from '@/server/pos/actor';
import { retailConfig } from '@/server/retail/config';
import { getActor, type Actor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH } from '@/server/studio/framework/invoke';
import { activeAnnouncements } from '@/server/studio/queries/announcements';
import { myRestaurants } from '@/server/studio/queries/account';
import { myRetailShops } from '@/server/studio/queries/retail';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly, isRetailOnly, openRetailNavItem, posNavItem, spaceNav, visibleNav } from '@/studio/nav';
import { AnnouncementBar } from '@/studio/shell/AnnouncementBar';
import { BrandFooter } from '@/studio/shell/BrandFooter';
import { RetailOnlyNotice } from '@/studio/shell/RetailOnlyNotice';
import { Sidebar, type SidebarItem } from '@/studio/shell/Sidebar';
import { SpaceShell, type SpaceNavigation } from '@/studio/shell/SpaceShell';
import { SPACES } from '@/studio/spaces';

/** The person's role as the sidebar names it: Super Admin, else their role in their restaurants. */
function roleKey(actor: Actor): string {
  if (actor.isSuperAdmin) return 'role.SUPER_ADMIN';
  if (isRetailOnly(actor)) return 'retailOnly.role';
  return isOwnerOnly(actor) ? 'role.OWNER' : 'role.DESIGNER';
}

/** Retail's address for the Retail-only page, or null when the link is off or its address is not valid. */
function retailAddress(): string | null {
  const config = retailConfig();
  if (!config.enabled) return null;
  try {
    return config.baseUrl;
  } catch {
    return null;
  }
}

/**
 * Every signed-in page sits in this frame. Nobody signed in goes to sign-in; a Super Admin without two-factor goes to
 * set it up (that page is outside this layout, so the redirect cannot loop). The navigation shows only the areas the
 * person may use, in their language. A Super Admin works in closed spaces, one per project: the project icons at
 * `/studio`, and inside a space only that project's pages (`src/studio/spaces.ts`); the frame picks the space from the
 * address in the browser (SpaceShell).
 * An account made for Buzzify Retail sees one page that points there, whatever Studio address it opened, and no working areas.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (actor.isSuperAdmin && !actor.twoFactorEnabled) redirect(TWO_FACTOR_SETUP_PATH);

  const t = getStudioTranslator(actor.locale);
  const user = { name: actor.name, email: actor.email, role: t(roleKey(actor)) };

  if (actor.isSuperAdmin) {
    // The Cashier item shows only to a person whose restaurant has the till open: it belongs to Menu and Cashier alone.
    const pos = await getPosAccess();
    const tillOpen = Boolean(pos.actor && pos.gate?.open);
    const spaces: SpaceNavigation[] = SPACES.map((space) => {
      const navItems = space.id === 'food' && tillOpen ? [...spaceNav(space.id), posNavItem()] : spaceNav(space.id);
      return {
        id: space.id,
        name: t(space.nameKey),
        items: navItems.map(({ labelKey, label, scope, ...item }) => ({ ...item, label: label ?? t(labelKey) })),
      };
    });
    return (
      <SpaceShell
        spaces={spaces}
        user={user}
        skipLabel={t('common.skipToContent')}
        announcements={<AnnouncementBar userId={actor.userId} initial={await query(activeAnnouncements, {})} />}
        footer={<BrandFooter />}
      >
        {children}
      </SpaceShell>
    );
  }

  const retailOnly = isRetailOnly(actor);
  const owned = isOwnerOnly(actor)
    ? (await query(myRestaurants, {})).map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        menuIds: restaurant.menus.map((menu) => menu.id),
      }))
    : [];
  // The Cashier item shows only to a person whose restaurant has the till open: a menu-only restaurant sees no trace of it.
  const pos = retailOnly ? null : await getPosAccess();
  // An owner of Buzzify Retail shops gets "Open Retails" while the link is on (never a Super Admin: Retails has its own admin).
  const openRetail = !retailOnly && !actor.isSuperAdmin && retailConfig().enabled ? openRetailNavItem(actor, await query(myRetailShops, {})) : null;
  const navItems = [...visibleNav(actor, owned), ...(pos?.actor && pos.gate?.open ? [posNavItem()] : []), ...(openRetail ? [openRetail] : [])];
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
          {retailOnly ? <RetailOnlyNotice t={t} retailUrl={retailAddress()} /> : children}
        </main>
        <BrandFooter />
      </div>
    </div>
  );
}
