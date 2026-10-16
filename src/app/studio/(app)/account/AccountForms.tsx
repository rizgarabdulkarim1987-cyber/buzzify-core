'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { changePassword, requestEmailChange, setStudioLanguage } from '@/app/studio/_actions/account';
import { LOCALE_NAMES, LOCALES } from '@/lib/locale';
import { requireFields, useActionForm } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input, PasswordInput } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { Select } from '@/studio/ui/Select';

/** Asks to change the sign-in address: the current address approves first, then the new one confirms. */
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const t = useT();
  const [sent, setSent] = useState(false);
  const form = useActionForm((values) => requestEmailChange({ newEmail: values.newEmail ?? '' }), {
    keep: ['newEmail'],
    validate: (values) => requireFields(values, { newEmail: t('error.text.emailInvalid') }),
    onSuccess: () => setSent(true),
  });

  return (
    <form {...form.props} className="flex max-w-md flex-col gap-4">
      {sent && <Alert tone="success">{isolated(t('account.email.sent'), { email: currentEmail })}</Alert>}
      <FormError form={form} fields={['newEmail']} />
      <Field label={t('account.email.new')} error={form.fieldError('newEmail')}>
        <Input name="newEmail" type="email" dir="ltr" className="rtl:text-right" autoComplete="email" defaultValue={form.value('newEmail')} />
      </Field>
      <Button type="submit" pending={form.pending} className="self-start">
        {t('account.email.submit')}
      </Button>
    </form>
  );
}

/** The interface language, saved on the account: the whole Studio, and the emails, follow it. */
export function LanguageForm() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const form = useActionForm((values) => setStudioLanguage({ locale: values.locale ?? '' }), {
    onSuccess: () => router.refresh(),
  });

  return (
    <form {...form.props} className="flex max-w-md flex-col gap-4">
      <FormError form={form} fields={['locale']} />
      <Field label={t('account.language.title')} hideLabel error={form.fieldError('locale')}>
        <Select
          name="locale"
          defaultValue={locale}
          key={locale}
          options={LOCALES.map((value) => ({ value, label: LOCALE_NAMES[value], lang: value }))}
        />
      </Field>
      <Button type="submit" pending={form.pending} className="self-start">
        {t('common.save')}
      </Button>
    </form>
  );
}

/** Changes the password. Better Auth signs every other browser out and gives this one a new session. */
export function PasswordForm() {
  const t = useT();
  const form = useActionForm((values) => changePassword({ current: values.current ?? '', next: values.next ?? '' }), {
    validate: (values) => {
      const missing = requireFields(values, { current: t('error.text.passwordEnter'), next: t('error.text.passwordChoose') });
      if (Object.keys(missing).length > 0) return missing;
      return values.next === values.confirm ? null : { confirm: t('auth.passwordMismatch') };
    },
    onSuccess: () => {
      toast.success(t('account.password.changed'));
    },
  });

  return (
    <form {...form.props} className="flex max-w-md flex-col gap-4">
      <FormError form={form} fields={['current', 'next', 'confirm']} />
      <Field label={t('account.password.current')} error={form.fieldError('current')}>
        <PasswordInput name="current" autoComplete="current-password" />
      </Field>
      <Field label={t('account.password.new')} hint={t('auth.passwordHint')} error={form.fieldError('next')}>
        <PasswordInput name="next" autoComplete="new-password" />
      </Field>
      <Field label={t('account.password.confirm')} error={form.fieldError('confirm')}>
        <PasswordInput name="confirm" autoComplete="new-password" />
      </Field>
      <Button type="submit" pending={form.pending} className="self-start">
        {t('account.password.submit')}
      </Button>
    </form>
  );
}
