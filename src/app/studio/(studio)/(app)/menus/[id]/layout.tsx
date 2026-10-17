import { ChevronLeft, Eye } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { hostEnv } from '@/server/env';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import type { Permission } from '@/server/domain/permissions';
import { formatDateTime, numberFormat } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly } from '@/studio/nav';
import { Alert } from '@/studio/ui/Alert';
import { buttonClasses } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RouteTabs } from '@/studio/ui/RouteTabs';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { visibleTabs } from '@/studio/workspace/tabs';
import { MenuStatusBadge } from '../menu-text';
import { loadMenu } from './load';
import { MenuActions } from './MenuActions';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: (await loadMenu((await params).id)).name };
}

/**
 * The frame of a menu's workspace (spec 10.3): where it belongs and where guests find it, then a bar that stays in view
 * while the person works: the tabs they may use, whether the draft differs from what guests see, Preview, Publish and
 * the menu's other actions.
 */
export default async function MenuWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const menu = await loadMenu(id);
  const number = numberFormat(actor.locale);

  const base = `/studio/menus/${menu.id}`;
  const tabs = visibleTabs(new Set(menu.permissions as Permission[])).map((tab) => ({
    href: `${base}${tab.path}`,
    label: t(tab.labelKey),
    exact: tab.path === '',
  }));
  const back = isOwnerOnly(actor)
    ? { href: `/studio/restaurants/${menu.restaurant.id}/menus`, label: menu.restaurant.name }
    : { href: '/studio/menus', label: t('menus.title') };

  return (
    <>
      <PageHeader
        above={
          <Link href={back.href} className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {back.label}
          </Link>
        }
        title={menu.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Link href={`/studio/restaurants/${menu.restaurant.id}`} className="text-text underline-offset-2 hover:underline">
              {menu.restaurant.name}
            </Link>
            <span dir="ltr" className="font-mono text-sm">
              {menu.restaurant.clientId}
            </span>
            <MenuStatusBadge status={menu.status} t={t} />
            <span className="text-sm">
              {menu.liveRevision
                ? menu.liveRevision.publishedBy
                  ? isolated(
                      t('workspace.liveBy', {
                        number: number.format(menu.liveRevision.number),
                        date: formatDateTime(menu.liveRevision.wentLiveAt, actor.locale),
                      }),
                      { name: menu.liveRevision.publishedBy },
                    )
                  : t('workspace.live', {
                      number: number.format(menu.liveRevision.number),
                      date: formatDateTime(menu.liveRevision.wentLiveAt, actor.locale),
                    })
                : t('workspace.notLive')}
            </span>
            <span className="inline-flex items-center gap-1">
              <a
                href={menu.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="font-mono text-sm text-text underline-offset-2 hover:underline"
              >
                {menu.publicUrl.replace(/^https?:\/\//, '')}
              </a>
              <CopyButton value={menu.publicUrl} />
            </span>
            {menu.formerSlugs.length > 0 && (
              <span className="text-sm text-muted">
                {t('menus.address.former')}{' '}
                {menu.formerSlugs.map((slug, index) => (
                  <span key={slug}>
                    {index > 0 && ', '}
                    <bdi dir="ltr" className="font-mono">
                      /{slug}
                    </bdi>
                  </span>
                ))}
              </span>
            )}
          </span>
        }
      />

      <div className="sticky top-0 z-20 border-b border-line bg-bg px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <RouteTabs tabs={tabs} label={t('workspace.tabs.label')} className="min-w-0 border-b-0" />
          <div className="flex shrink-0 items-center gap-2 py-1.5">
            {menu.liveRevision &&
              (menu.unpublished ? (
                <StatusBadge>{t('menus.unpublished')}</StatusBadge>
              ) : (
                <span className="text-sm text-muted">{t('workspace.upToDate')}</span>
              ))}
            <Link href={`${base}/preview`} className={buttonClasses('secondary', 'md')}>
              <Eye aria-hidden />
              {t('workspace.openPreview')}
            </Link>
            <MenuActions
              menu={{
                id: menu.id,
                name: menu.name,
                slug: menu.slug,
                status: menu.status,
                statusBeforeArchive: menu.statusBeforeArchive,
                version: menu.version,
                restaurantId: menu.restaurant.id,
                hasLiveRevision: menu.liveRevision !== null,
                timezone: menu.timezone,
                pendingSchedule: menu.pendingSchedule,
              }}
              can={menu.can}
              duplicateTargets={menu.duplicateTargets}
              origin={hostEnv().publicOrigin}
            />
          </div>
        </div>
      </div>

      {(menu.status === 'SUSPENDED' || menu.status === 'ARCHIVED' || menu.restaurant.status !== 'ACTIVE') && (
        <div className="flex flex-col gap-3 px-8 pt-5">
          {(menu.status === 'SUSPENDED' || menu.status === 'ARCHIVED') && <Alert tone="neutral">{t(`menus.notice.${menu.status}`)}</Alert>}
          {menu.restaurant.status !== 'ACTIVE' && <Alert tone="neutral">{t(`menus.notice.restaurant.${menu.restaurant.status}`)}</Alert>}
        </div>
      )}
      {children}
    </>
  );
}
