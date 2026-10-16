import { ChevronLeft, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { cache } from 'react';
import { hostEnv } from '@/server/env';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { getMenu } from '@/server/studio/queries/menus';
import { formatDateTime } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly } from '@/studio/nav';
import { Alert } from '@/studio/ui/Alert';
import { buttonClasses } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { issueText, languageName, MenuStatusBadge } from '../menu-text';
import { MenuActions } from './MenuActions';

/** The menu of the page's address, read once per request for the page and its title. */
const loadMenu = cache((menuId: string) => query(getMenu, { menuId }));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: (await loadMenu((await params).id)).name };
}

/** One part of the page: its heading on the start side, what it says beside it. */
function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-3 border-t border-line py-6 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div className="flex min-w-0 max-w-3xl flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * A menu: where guests find it, what they see now, what stands in the way of publishing the draft, and its settings.
 * Publishing and everything done to the menu as a whole sit in the header. The editing workspace comes later.
 */
export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const menu = await loadMenu(id);
  const number = new Intl.NumberFormat(actor.locale);
  const blocking = menu.issues.filter((issue) => issue.severity === 'block');
  const warnings = menu.issues.filter((issue) => issue.severity === 'warn');
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
            {menu.unpublished && <StatusBadge>{t('menus.unpublished')}</StatusBadge>}
          </span>
        }
        actions={
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
            }}
            can={menu.can}
            duplicateTargets={menu.duplicateTargets}
            origin={hostEnv().publicOrigin}
          />
        }
      />

      <div className="flex flex-col gap-3 px-8">
        {(menu.status === 'SUSPENDED' || menu.status === 'ARCHIVED') && <Alert tone="neutral">{t(`menus.notice.${menu.status}`)}</Alert>}
        {menu.restaurant.status !== 'ACTIVE' && <Alert tone="neutral">{t(`menus.notice.restaurant.${menu.restaurant.status}`)}</Alert>}
      </div>

      <div className="flex max-w-6xl flex-col px-8 pb-10 pt-3">
        <Section id="menu-address" title={t('menus.address.title')} intro={t('menus.address.intro')}>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={menu.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="min-w-0 break-all rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-sm text-text underline-offset-2 hover:underline"
            >
              {menu.publicUrl}
            </a>
            <CopyButton value={menu.publicUrl} />
            <a
              href={menu.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('menus.address.openLabel')}
              className={buttonClasses('secondary', 'sm')}
            >
              <ExternalLink aria-hidden />
              {t('menus.address.open')}
            </a>
          </div>
          {menu.formerSlugs.length > 0 && (
            <p className="text-sm text-muted">
              {t('menus.address.former')}{' '}
              {menu.formerSlugs.map((slug, index) => (
                <span key={slug}>
                  {index > 0 && ', '}
                  <bdi dir="ltr" className="font-mono">
                    /{slug}
                  </bdi>
                </span>
              ))}
            </p>
          )}
        </Section>

        <Section id="menu-live" title={t('menus.live.title')}>
          {menu.liveRevision ? (
            <>
              <p className="text-base text-text">
                <span className="font-medium">{t('menus.live.revision', { number: number.format(menu.liveRevision.number) })}</span>
                <span className="text-muted"> · {t('menus.live.since', { time: formatDateTime(menu.liveRevision.wentLiveAt, actor.locale) })}</span>
                {menu.liveRevision.publishedBy && (
                  <span className="text-muted"> · {isolated(t('menus.live.by'), { name: menu.liveRevision.publishedBy })}</span>
                )}
              </p>
              <p className="text-sm text-muted">{menu.unpublished ? t('menus.live.unpublished') : t('menus.live.upToDate')}</p>
            </>
          ) : (
            <p className="text-base text-muted">{t('menus.live.none')}</p>
          )}
        </Section>

        <Section id="menu-issues" title={t('menus.issues.title')}>
          {menu.issues.length === 0 ? (
            <p className="text-base text-muted">{t('menus.issues.none')}</p>
          ) : (
            <>
              {blocking.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium text-danger">{t('menus.issues.blocking')}</h3>
                  <ul className="flex flex-col gap-1 text-sm text-text">
                    {blocking.map((issue, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger" />
                        {issueText(t, issue)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium text-text">{t('menus.issues.warnings')}</h3>
                  <ul className="flex flex-col gap-1 text-sm text-muted">
                    {warnings.map((issue, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted" />
                        {issueText(t, issue)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Section>

        <Section id="menu-settings" title={t('menus.settings.title')}>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-8 gap-y-2 text-base">
            <dt className="text-muted">{t('menus.settings.languages')}</dt>
            <dd className="text-text">{menu.locales.map((code) => languageName(t, code)).join(' · ')}</dd>
            <dt className="text-muted">{t('menus.settings.defaultLanguage')}</dt>
            <dd className="text-text">{languageName(t, menu.defaultLocale)}</dd>
            <dt className="text-muted">{t('menus.settings.currency')}</dt>
            <dd dir="ltr" className="text-text rtl:text-end">
              {menu.currency}
            </dd>
            <dt className="text-muted">{t('menus.settings.timezone')}</dt>
            <dd dir="ltr" className="text-text rtl:text-end">
              {menu.timezone}
            </dd>
            <dt className="text-muted">{t('menus.settings.numerals')}</dt>
            <dd className="text-text">{t(`menus.numerals.${menu.numeralSystem}`)}</dd>
            <dt className="text-muted">{t('menus.settings.categories')}</dt>
            <dd className="tabular-nums text-text">{number.format(menu.counts.categories)}</dd>
            <dt className="text-muted">{t('menus.settings.products')}</dt>
            <dd className="tabular-nums text-text">{number.format(menu.counts.products)}</dd>
            <dt className="text-muted">{t('menus.settings.tables')}</dt>
            <dd className="tabular-nums text-text">{number.format(menu.counts.tables)}</dd>
          </dl>
        </Section>
      </div>
    </>
  );
}
