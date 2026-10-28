import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LAYOUT_COOKIE, layoutOf } from '@/lib/pos-floor';
import { idleMinutesFor } from '@/lib/pos-idle';
import { tillNav } from '@/server/domain/pos/nav';
import { getPosAccess } from '@/server/pos/actor';
import { currentDevice } from '@/server/pos/device-session';
import { posEntry } from '@/server/pos/entry';
import { canPos } from '@/server/domain/pos/permissions';
import { getActor } from '@/server/studio/auth/actor';
import { query } from '@/server/studio/framework/invoke';
import { posMyShift, posPrinters } from '@/server/studio/queries/pos';
import { PrintProvider } from '@/app/pos/_ui/print/PrintProvider';
import { posAiState } from '@/server/studio/queries/pos-ai';
import { posIdleMinutes } from '@/server/studio/queries/pos-idle';
import { posComplaintBadge } from '@/server/studio/queries/pos-complaints';
import { activeAnnouncements } from '@/server/studio/queries/announcements';
import { posRestaurantLogo } from '@/server/studio/queries/pos-brand';
import { posQrFlags } from '@/server/studio/queries/pos-requests';
import { getStudioTranslator } from '@/studio/messages';
import { AnnouncementBar } from '@/studio/shell/AnnouncementBar';
import { BrandFooter } from '@/studio/shell/BrandFooter';
import { BrandLogo } from '@/studio/shell/BrandLogo';
import { IdleGuard } from '@/app/pos/_ui/IdleGuard';
import { LayoutPicker } from '@/app/pos/_ui/floor/LayoutPicker';
import { ShiftPill } from '@/app/pos/_ui/ShiftPill';
import { SignOutButton } from '@/app/pos/_ui/SignOutButton';
import { SwitchUserButton } from '@/app/pos/_ui/SwitchUserButton';
import { AppearanceCache } from '@/app/pos/_ui/sync/AppearanceCache';
import { appearanceVars, parseStoredAppearance } from '@/lib/appearance';
import { TillNav } from '@/app/pos/_ui/TillNav';
import { OfflineRedirect } from '@/app/pos/_ui/sync/OfflineRedirect';
import { RegisterSw } from '@/app/pos/_ui/sync/RegisterSw';
import { SyncIndicator } from '@/app/pos/_ui/sync/SyncIndicator';

/**
 * Every till page sits in this frame. Nobody signed in goes to the shared sign-in, a person with no till gets a 404, and a
 * closed gate (restaurant not active, or no live Cashier subscription) shows the reason page instead of the till.
 */
export default async function TillLayout({ children }: { children: ReactNode }) {
  const entry = posEntry(await getPosAccess());
  if (entry.kind === 'signIn') redirect(entry.to);
  if (entry.kind === 'notFound') notFound();
  if (entry.kind === 'inactive') redirect('/pos/inactive');

  const t = getStudioTranslator(entry.actor.locale);
  // The root layout wears this look; the cache keeps it for the offline till.
  const studioActor = await getActor();
  const look = parseStoredAppearance(studioActor?.appearance);
  const notices = studioActor ? await query(activeAnnouncements, {}) : [];
  const lookVars = appearanceVars(look);
  const logo = await query(posRestaurantLogo, {});
  const sharedDevice = (await currentDevice())?.restaurantId === entry.actor.restaurantId;
  const handlesOrders = canPos(entry.actor.role, 'order.handle');
  const flags = handlesOrders ? await query(posQrFlags, {}) : { qrOrdering: false, delivery: false, pendingRequests: 0 };
  const complaints = canPos(entry.actor.role, 'complaint.view') ? await query(posComplaintBadge, {}) : { show: false, count: 0 };
  const ai = canPos(entry.actor.role, 'report.view') ? await query(posAiState, {}) : { enabled: false };
  const items = tillNav(entry.actor.role, { qrOrdering: flags.qrOrdering, delivery: flags.delivery, complaints: complaints.show, ai: ai.enabled }).map((item) => ({ ...item, badge: item.key === 'requests' ? flags.pendingRequests : item.key === 'complaints' ? complaints.count : 0 }));
  const shift = canPos(entry.actor.role, 'shift.use') ? await query(posMyShift, {}) : { shiftId: null, openedAt: null, readAt: null };
  const idleMinutes = await query(posIdleMinutes, {});
  const printers = await query(posPrinters, {});
  const layout = layoutOf((await cookies()).get(LAYOUT_COOKIE)?.value);
  // From lg up the till is one screen: the page never scrolls, a page taller than the screen scrolls inside <main>.
  return (
    <div data-layout={layout} className="till flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden print:block print:h-auto print:overflow-visible">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <header className="print:hidden flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-8">
        <Link href="/pos" className="flex shrink-0 items-center gap-3 text-lg font-bold text-text">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the restaurant's own uploaded file, any size
            <img src={logo.url} alt="" width={logo.width} height={logo.height} className="h-8 w-auto max-w-40 object-contain" />
          ) : (
            <BrandLogo height={20} />
          )}
          <span>{t('pos.shell.label')}</span>
        </Link>
        <TillNav items={items} className="order-last w-full" />
        <div className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>
            {entry.actor.name} · {t(`pos.role.${entry.actor.role}`)}
          </span>
          <Link href="/pos/pin" className="underline underline-offset-2">
            {t('pos.pin.title')}
          </Link>
          <Link href="/studio/account" className="underline underline-offset-2">
            {t('pos.shell.account')}
          </Link>
          {handlesOrders ? <LayoutPicker current={layout} /> : null}
          <SyncIndicator />
          {shift.openedAt && shift.readAt ? <ShiftPill openedAt={new Date(shift.openedAt).getTime()} readAt={new Date(shift.readAt).getTime()} /> : null}
          {sharedDevice ? <SwitchUserButton /> : <SignOutButton />}
        </div>
      </header>
      <AppearanceCache userId={entry.actor.userId} vars={lookVars} shape={Object.keys(lookVars).length > 0 ? look.shape : null} />
      <RegisterSw />
      <OfflineRedirect />
      <IdleGuard minutes={idleMinutesFor(entry.actor.role, idleMinutes)} shared={sharedDevice} />
      <AnnouncementBar userId={entry.actor.userId} initial={notices} />
      <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto print:block print:overflow-visible">
        <PrintProvider printers={printers}>{children}</PrintProvider>
      </main>
      <BrandFooter />
    </div>
  );
}
