import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { getActor, type Actor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listMySessions } from '@/server/studio/queries/account';
import { describeUserAgent, formatDateTime } from '@/studio/format';
import { DEFAULT_APPEARANCE } from '@/lib/appearance';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';
import { EmailChangeForm, LanguageForm, PasswordForm } from './AccountForms';
import { AppearanceForm } from './AppearanceForm';
import { SessionsTable, type SessionView } from './SessionsTable';
import { TwoFactorPanel } from './TwoFactorPanel';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('account.title') };
}

/** One part of the page: its heading and what it is about on the start side, its controls beside them. */
function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-4 border-t border-line py-8 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function roleLabel(actor: Actor, t: Translate): string {
  if (actor.isSuperAdmin) return t('role.SUPER_ADMIN');
  return t(isOwnerOnly(actor) ? 'role.OWNER' : 'role.DESIGNER');
}

function accessLabel(actor: Actor, t: Translate): string {
  if (actor.isSuperAdmin) return t('account.profile.everyRestaurant');
  const count = new Set(actor.memberships.map((m) => m.restaurantId)).size;
  return count === 0 ? t('account.profile.noRestaurants') : t('account.profile.restaurants', { count });
}

export default async function AccountPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const sessions = await query(listMySessions, {});

  const sessionViews: SessionView[] = sessions.map((session) => {
    const { browser, system } = describeUserAgent(session.userAgent);
    const name = browser ?? t('account.sessions.unknownBrowser');
    return {
      id: session.id,
      current: session.current,
      browser: system ? t('account.sessions.browserOn', { browser: name, system }) : name,
      address: session.ipAddress || t('account.sessions.unknownAddress'),
      started: formatDateTime(session.createdAt, actor.locale),
      expires: formatDateTime(session.expiresAt, actor.locale),
    };
  });

  return (
    <>
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <div className="max-w-6xl px-8 pb-16">
        <Section id="profile" title={t('account.profile.title')} intro={t('account.profile.intro')}>
          <dl className="grid max-w-xl grid-cols-[8rem_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-base">
            <dt className="text-muted">{t('account.profile.name')}</dt>
            <dd className="font-medium text-text">{actor.name}</dd>
            <dt className="text-muted">{t('account.profile.role')}</dt>
            <dd className="text-text">{roleLabel(actor, t)}</dd>
            <dt className="text-muted">{t('account.profile.access')}</dt>
            <dd className="text-text">{accessLabel(actor, t)}</dd>
          </dl>
        </Section>

        <Section id="email" title={t('account.email.title')} intro={isolated(t('account.email.intro'), { email: actor.email })}>
          <EmailChangeForm currentEmail={actor.email} />
        </Section>

        <Section id="language" title={t('account.language.title')} intro={t('account.language.intro')}>
          <LanguageForm />
        </Section>

        <Section id="appearance" title={t('account.appearance.title')} intro={t('account.appearance.intro')}>
          <AppearanceForm initial={actor.appearance ?? DEFAULT_APPEARANCE} />
        </Section>

        <Section id="password" title={t('account.password.title')} intro={t('account.password.intro')}>
          <PasswordForm />
        </Section>

        <Section id="two-factor" title={t('account.twoFactor.title')}>
          <TwoFactorPanel enabled={actor.twoFactorEnabled} superAdmin={actor.isSuperAdmin} email={actor.email} />
        </Section>

        <Section id="sessions" title={t('account.sessions.title')} intro={t('account.sessions.intro')}>
          <SessionsTable sessions={sessionViews} />
        </Section>
      </div>
    </>
  );
}
