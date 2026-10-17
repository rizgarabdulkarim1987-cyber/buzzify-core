'use client';

import Link from 'next/link';
import { resetPassword } from '@/app/studio/_actions/session';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { PasswordInput } from '@/studio/ui/Input';

export function ResetForm({ token }: { token: string }) {
  const t = useT();
  const form = useActionForm((values) => resetPassword({ token, password: values.password ?? '' }), {
    validate: (values) => {
      const missing = requireFields(values, { password: t('error.text.passwordChoose') });
      if (Object.keys(missing).length > 0) return missing;
      return values.password === values.confirm ? null : { confirm: t('auth.passwordMismatch') };
    },
    onSuccess: () => navigateAway('/studio/sign-in?notice=reset'),
  });
  // The link is spent or has expired: a new one is the way on.
  const linkProblem = form.failure?.fields.token !== undefined;

  return (
    <form {...form.props} className="flex flex-col gap-5">
      <FormError form={form} fields={['password', 'confirm']}>
        {linkProblem && (
          <>
            {' '}
            <Link href="/studio/forgot" className="font-medium underline underline-offset-2">
              {t('auth.reset.requestNew')}
            </Link>
          </>
        )}
      </FormError>
      <Field label={t('auth.reset.password')} hint={t('auth.passwordHint')} error={form.fieldError('password')}>
        <PasswordInput name="password" size="lg" autoComplete="new-password" autoFocus />
      </Field>
      <Field label={t('auth.reset.confirm')} error={form.fieldError('confirm')}>
        <PasswordInput name="confirm" size="lg" autoComplete="new-password" />
      </Field>
      <Button type="submit" variant="primary" size="lg" pending={form.pending} className="mt-1 w-full">
        {form.pending ? t('auth.reset.pending') : t('auth.reset.submit')}
      </Button>
    </form>
  );
}
