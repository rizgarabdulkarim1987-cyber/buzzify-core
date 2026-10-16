'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { acceptInvitationAction } from '@/app/studio/_actions/people';
import { signOut } from '@/app/studio/_actions/session';
import type { InvitationView } from '@/server/studio/services/invitations';
import { describeFailure } from '@/studio/errors';
import { formMessage, requireFields, useActionForm } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input, PasswordInput } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';

const ROLE_KEYS = {
  OWNER: 'role.OWNER',
  DESIGNER: 'role.DESIGNER',
  DESIGNER_STAFF: 'role.DESIGNER',
  SUPER_ADMIN: 'role.SUPER_ADMIN',
} as const;

const CLOSED = {
  expired: ['auth.invite.expiredTitle', 'auth.invite.expiredBody'],
  used: ['auth.invite.usedTitle', 'auth.invite.usedBody'],
  revoked: ['auth.invite.revokedTitle', 'auth.invite.revokedBody'],
  unknown: ['auth.invite.unknownTitle', 'auth.invite.unknownBody'],
} as const;

/**
 * An invitation, from opening the link to entering the Studio. Accepting signs a new person in (or changes the existing
 * account), which makes the server render this page again with the invitation used; the flow keeps showing its own
 * progress until the browser has moved on, instead of flashing "already used".
 */
export function InviteFlow({ token, view, signedInEmail }: { token: string; view: InvitationView; signedInEmail: string | null }) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const back = (
    <Link href="/studio/sign-in" className="hover:text-text hover:underline">
      {t('auth.backToSignIn')}
    </Link>
  );

  if (opening) return <AuthPanel title={t('auth.invite.title')} intro={t('auth.invite.opening')} />;

  if (view.status !== 'valid' || !view.email || !view.role) {
    const [title, body] = CLOSED[view.status === 'valid' ? 'unknown' : view.status];
    return <AuthPanel title={t(title)} intro={t(body)} footer={back} />;
  }

  const role = t(ROLE_KEYS[view.role]);
  const summary = view.restaurantName
    ? isolated(t('auth.invite.forRestaurant', { role }), { restaurant: view.restaurantName })
    : t('auth.invite.forRole', { role });
  const open = (next: string) => {
    setOpening(true);
    return navigateAway(next);
  };

  return (
    <AuthPanel
      title={t('auth.invite.title')}
      intro={summary}
      notices={
        <div className="flex flex-col gap-0.5 rounded-md border border-line bg-surface px-3 py-2.5">
          <span className="text-xs text-muted">{t('auth.invite.address')}</span>
          <span dir="ltr" className="truncate text-base font-medium text-text rtl:text-right">
            {view.email}
          </span>
        </div>
      }
      footer={view.accountExists ? back : undefined}
    >
      {!view.accountExists ? (
        <NewAccountForm token={token} onAccepted={open} />
      ) : signedInEmail === view.email ? (
        <AcceptButton token={token} onAccepted={open} />
      ) : signedInEmail ? (
        <WrongAccount signedInEmail={signedInEmail} token={token} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base text-muted">{t('auth.invite.existingIntro')}</p>
          <Link
            href={`/studio/sign-in?next=${encodeURIComponent(`/studio/invite/${token}`)}`}
            className={buttonClasses('primary', 'lg', 'w-full')}
          >
            {t('auth.invite.signInToAccept')}
          </Link>
        </div>
      )}
    </AuthPanel>
  );
}

function NewAccountForm({ token, onAccepted }: { token: string; onAccepted: (next: string) => Promise<never> }) {
  const t = useT();
  const form = useActionForm(
    (values) => acceptInvitationAction({ token, name: values.name ?? '', password: values.password ?? '' }),
    {
      keep: ['name'],
      validate: (values) =>
        requireFields(values, { name: t('error.text.nameEnter'), password: t('error.text.passwordChoose') }),
      onSuccess: (data) => onAccepted(data.next),
    },
  );
  const message = formMessage(form.failure, ['name', 'password']);

  return (
    <form {...form.props} className="flex flex-col gap-5">
      <p className="text-base text-muted">{t('auth.invite.newIntro')}</p>
      {message && <Alert tone="danger">{message}</Alert>}
      <Field label={t('auth.invite.name')} error={form.fieldError('name')}>
        <Input name="name" size="lg" autoComplete="name" maxLength={120} autoFocus defaultValue={form.value('name')} />
      </Field>
      <Field label={t('auth.invite.password')} hint={t('auth.passwordHint')} error={form.fieldError('password')}>
        <PasswordInput name="password" size="lg" autoComplete="new-password" />
      </Field>
      <Button type="submit" variant="primary" size="lg" pending={form.pending} className="mt-1 w-full">
        {form.pending ? t('auth.invite.creating') : t('auth.invite.create')}
      </Button>
    </form>
  );
}

function AcceptButton({ token, onAccepted }: { token: string; onAccepted: (next: string) => Promise<never> }) {
  const t = useT();
  const form = useActionForm(() => acceptInvitationAction({ token }), { onSuccess: (data) => onAccepted(data.next) });
  return (
    <form {...form.props} className="flex flex-col gap-4">
      {form.failure && <Alert tone="danger">{form.failure.message}</Alert>}
      <Button type="submit" variant="primary" size="lg" pending={form.pending} className="w-full">
        {form.pending ? t('auth.invite.accepting') : t('auth.invite.accept')}
      </Button>
    </form>
  );
}

/** Signed in as someone else: an invitation is never attached to whoever happens to be signed in. */
function WrongAccount({ signedInEmail, token }: { signedInEmail: string; token: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Alert>{isolated(t('auth.invite.otherAccount'), { email: signedInEmail })}</Alert>
      {problem && <Alert tone="danger">{problem}</Alert>}
      <Button
        variant="secondary"
        size="lg"
        pending={pending}
        className="w-full"
        onClick={() =>
          startTransition(async () => {
            const result = await signOut({});
            if (result.ok) return navigateAway(`/studio/invite/${token}`);
            setProblem(describeFailure(t, locale, result.error).message);
          })
        }
      >
        {t('nav.signOut')}
      </Button>
    </div>
  );
}
