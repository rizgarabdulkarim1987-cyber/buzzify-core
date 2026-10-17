'use client';

import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { requestPasswordReset } from '@/app/studio/_actions/session';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';

/**
 * Asks for a reset link. The answer is the same whether or not the address has an account, so the page never says
 * which addresses do.
 */
export function ForgotForm() {
  const t = useT();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useActionForm((values) => requestPasswordReset({ email: values.email ?? '' }), {
    keep: ['email'],
    validate: (values) => requireFields(values, { email: t('error.text.emailInvalid') }),
    onSuccess: (_data, values) => setSentTo((values.email ?? '').trim()),
  });

  if (sentTo !== null) {
    return (
      <div role="status" className="flex flex-col items-start gap-4">
        <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface text-text">
          <MailCheck aria-hidden className="size-4" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-md font-semibold text-text">{t('auth.forgot.sentTitle')}</h2>
          <p className="text-base text-muted">
            {isolated(t('auth.forgot.sentBody'), { email: sentTo })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="text-sm text-muted underline-offset-2 hover:text-text hover:underline"
        >
          {t('auth.forgot.again')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-base text-muted">{t('auth.forgot.intro')}</p>
      <form {...form.props} className="flex flex-col gap-5">
        <FormError form={form} fields={['email']} />
        <Field label={t('auth.forgot.email')} error={form.fieldError('email')}>
          <Input
            name="email"
            type="email"
            size="lg"
            dir="ltr"
            className="rtl:text-right"
            autoComplete="username"
            autoFocus
            defaultValue={form.value('email')}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" pending={form.pending} className="w-full">
          {form.pending ? t('auth.forgot.pending') : t('auth.forgot.submit')}
        </Button>
      </form>
    </div>
  );
}
