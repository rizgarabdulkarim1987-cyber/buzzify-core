import { ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../(app)/catalog/access';

/**
 * The part every pharmacy screen group's gate shares: who is signed in here, the translator, the "back" link, and the blocked state for a role
 * without `permission` (or a support actor) that the page returns BEFORE any query, so nothing is fetched for them. `messages` names the group's
 * texts (`<prefix>.forbidden.title|support|role`); `testid` marks the blocked state.
 */
export async function phGate(opts: { permission: Parameters<typeof roleMay>[1]; titleKey: string; backTo?: { href: string; labelKey: string }; testid: string; messages: string }) {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { backTo } = opts;
  const back = backTo ? (
    <Link href={backTo.href} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t(backTo.labelKey)}
    </Link>
  ) : undefined;
  const may = roleMay(access.actor, opts.permission);
  let blocked: ReactNode = null;
  if (!may) {
    blocked = (
      <>
        <PageHeader className="max-sm:px-4" title={t(opts.titleKey)} above={back} />
        <div data-testid={opts.testid} className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t(`${opts.messages}.forbidden.title`)} body={t(access.actor.role === null ? `${opts.messages}.forbidden.support` : `${opts.messages}.forbidden.role`)} />
        </div>
      </>
    );
  }
  return { access, locale, t, back, may, blocked };
}
