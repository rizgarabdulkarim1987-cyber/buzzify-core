'use client';

import Link from 'next/link';
import { signIn } from '@/app/studio/_actions/session';
import { TWO_FACTOR_PATH } from '@/server/studio/framework/paths';
import { formMessage, requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input, PasswordInput } from '@/studio/ui/Input';

/** Where to go once the password is right: the second step (carrying `next` along), or `next`, or the Studio. */
function destination(answer: string, next: string | null): string {
  if (answer === TWO_FACTOR_PATH) return next ? `${TWO_FACTOR_PATH}?next=${encodeURIComponent(next)}` : TWO_FACTOR_PATH;
  return next ?? answer;
}

export function SignInForm({ next }: { next: string | null }) {
  const t = useT();
  const form = useActionForm((values) => signIn({ email: values.email ?? '', password: values.password ?? '' }), {
    keep: ['email'],
    validate: (values) =>
      requireFields(values, { email: t('error.text.emailInvalid'), password: t('error.text.passwordEnter') }),
    onSuccess: (data) => navigateAway(destination(data.next, next)),
  });
  const message = formMessage(form.failure, ['email', 'password']);

  return (
    <form {...form.props} className="flex flex-col gap-5">
      {message && <Alert tone="danger">{message}</Alert>}
      <Field label={t('auth.signIn.email')} error={form.fieldError('email')}>
        <Input
          name="email"
          type="email"
          size="lg"
          dir="ltr"
          className="rtl:text-right"
          autoComplete="username"
          autoFocus
          required
          defaultValue={form.value('email')}
        />
      </Field>
      <Field
        label={t('auth.signIn.password')}
        error={form.fieldError('password')}
        aside={
          <Link href="/studio/forgot" className="text-sm text-muted underline-offset-2 hover:text-text hover:underline">
            {t('auth.signIn.forgot')}
          </Link>
        }
      >
        <PasswordInput name="password" size="lg" autoComplete="current-password" required />
      </Field>
      <Button type="submit" variant="primary" size="lg" pending={form.pending} className="mt-1 w-full">
        {form.pending ? t('auth.signIn.pending') : t('auth.signIn.submit')}
      </Button>
    </form>
  );
}
