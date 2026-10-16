'use client';

import Link from 'next/link';
import { useState } from 'react';
import { verifyTwoFactor } from '@/app/studio/_actions/session';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';

/** The code from the authenticator app, or, after "Use a recovery code instead", one of the ten recovery codes. */
export function TwoFactorForm({ next }: { next: string | null }) {
  const t = useT();
  const [recovery, setRecovery] = useState(false);
  const form = useActionForm((values) => verifyTwoFactor({ code: values.code ?? '' }), {
    validate: (values) =>
      requireFields(values, { code: recovery ? t('error.text.codeOrRecoveryFormat') : t('error.text.codeFormat') }),
    onSuccess: (data) => navigateAway(next ?? data.next),
  });
  // The challenge from the first step has ended (ten minutes, or five wrong codes): only signing in again helps.
  const ended = form.failure?.code === 'UNAUTHENTICATED';

  return (
    <div className="flex flex-col gap-6">
      <p className="text-base text-muted">{recovery ? t('auth.twoFactor.recoveryIntro') : t('auth.twoFactor.intro')}</p>
      <form key={recovery ? 'recovery' : 'app'} {...form.props} className="flex flex-col gap-5">
        <FormError form={form} fields={['code']}>
          {ended && (
            <>
              {' '}
              <Link href="/studio/sign-in" className="font-medium underline underline-offset-2">
                {t('auth.backToSignIn')}
              </Link>
            </>
          )}
        </FormError>
        {recovery ? (
          <Field label={t('auth.twoFactor.recoveryCode')} error={form.fieldError('code')}>
            <Input
              name="code"
              size="lg"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxxx-xxxxx"
              className="font-mono tracking-[0.06em] rtl:text-right"
              autoFocus
            />
          </Field>
        ) : (
          <Field label={t('auth.twoFactor.code')} error={form.fieldError('code')}>
            <Input
              name="code"
              size="lg"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              placeholder="000000"
              className="font-mono text-lg tracking-[0.3em] rtl:text-right"
              autoFocus
            />
          </Field>
        )}
        <Button type="submit" variant="primary" size="lg" pending={form.pending} className="w-full">
          {form.pending ? t('auth.twoFactor.pending') : t('auth.twoFactor.submit')}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => setRecovery((value) => !value)}
        className="self-start text-sm text-muted underline-offset-2 hover:text-text hover:underline"
      >
        {recovery ? t('auth.twoFactor.useApp') : t('auth.twoFactor.useRecovery')}
      </button>
    </div>
  );
}
