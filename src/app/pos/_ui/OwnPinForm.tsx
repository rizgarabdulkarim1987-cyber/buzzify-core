'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setOwnPosPin } from '@/app/studio/_actions/pos';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input, PasswordInput } from '@/studio/ui/Input';

/** Sets the signed-in person's own quick PIN; the account password confirms it. The PIN is never shown again. */
export function OwnPinForm({ hasPin }: { hasPin: boolean }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm((values) => setOwnPosPin({ pin: values.pin ?? '', password: values.password ?? '' }), {
    validate: (values) => {
      const missing = requireFields(values, { password: t('pos.pin.passwordEnter'), pin: t('error.text.posPinShape') });
      return Object.keys(missing).length > 0 || values.pin === values.confirm ? missing : { confirm: t('pos.pin.mismatch') };
    },
    onSuccess: () => {
      toast.success(t('pos.pin.saved'));
      router.refresh();
    },
  });
  return (
    <form {...form.props} className="flex max-w-md flex-col gap-4">
      <p className="text-sm text-muted">{hasPin ? t('pos.pin.current') : t('pos.pin.none')}</p>
      <FormError form={form} fields={['password', 'pin', 'confirm']} />
      <Field label={t('pos.pin.password')} error={form.fieldError('password')}>
        <PasswordInput name="password" autoComplete="current-password" />
      </Field>
      <Field label={t('pos.pin.value')} error={form.fieldError('pin')}>
        <Input name="pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" dir="ltr" className="rtl:text-right" />
      </Field>
      <Field label={t('pos.pin.confirm')} error={form.fieldError('confirm')}>
        <Input name="confirm" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" dir="ltr" className="rtl:text-right" />
      </Field>
      <Button type="submit" size="lg" pending={form.pending} className="min-h-12 self-start">
        {t('pos.pin.save')}
      </Button>
    </form>
  );
}
