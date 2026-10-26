'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updatePosSettings } from '@/app/studio/_actions/pos';
import { POS_PAYMENT_METHODS, type PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import type { PosSettingsView } from '@/server/pos/settings';
import { useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';

const SWITCHES = [
  ['kitchenPrintEnabled', 'pos.settings.kitchenPrint'],
  ['kitchenScreenEnabled', 'pos.settings.kitchenScreen'],
  ['qrOrderingEnabled', 'pos.settings.qrOrdering'],
  ['takeawayEnabled', 'pos.settings.takeaway'],
  ['deliveryEnabled', 'pos.settings.delivery'],
  ['complaintsEnabled', 'pos.settings.complaints'],
] as const;

/** The whole numbers a field holds; anything else goes to the server as it is, which refuses it. */
const whole = (value: string | undefined): number => (value && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);

export function SettingsForm({ settings }: { settings: PosSettingsView }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (values) =>
      updatePosSettings({
        serviceRatePercent: whole(values.serviceRatePercent),
        taxRatePercent: whole(values.taxRatePercent),
        tableRingMinutes: whole(values.tableRingMinutes),
        // Cash is always sent: its box is checked and disabled, and a disabled field is not part of the form.
        enabledPaymentMethods: POS_PAYMENT_METHODS.filter((method) => method === 'CASH' || values[`method.${method}`] === 'on'),
        ...Object.fromEntries(SWITCHES.map(([key]) => [key, values[key] === 'on'])),
        version: settings.version,
      }),
    {
      keep: ['serviceRatePercent', 'taxRatePercent', 'tableRingMinutes'],
      onSuccess: () => {
        toast.success(t('pos.settings.saved'));
        router.refresh();
      },
    },
  );
  const enabled = new Set<PosPaymentMethodKey>(settings.enabledPaymentMethods);

  return (
    <form key={settings.version} {...form.props} className="flex max-w-xl flex-col gap-6">
      <FormError form={form} fields={['serviceRatePercent', 'taxRatePercent', 'tableRingMinutes', 'enabledPaymentMethods']} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('pos.settings.service')} error={form.fieldError('serviceRatePercent')}>
          <Input name="serviceRatePercent" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={form.value('serviceRatePercent') ?? String(settings.serviceRatePercent)} />
        </Field>
        <Field label={t('pos.settings.tax')} error={form.fieldError('taxRatePercent')}>
          <Input name="taxRatePercent" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={form.value('taxRatePercent') ?? String(settings.taxRatePercent)} />
        </Field>
        <Field label={t('pos.settings.ring')} error={form.fieldError('tableRingMinutes')}>
          <Input name="tableRingMinutes" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={form.value('tableRingMinutes') ?? String(settings.tableRingMinutes)} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">{t('pos.settings.methods')}</legend>
        <p className="text-sm text-muted">{t('pos.settings.methodsHint')}</p>
        {POS_PAYMENT_METHODS.map((method) => (
          <Checkbox
            key={method}
            name={`method.${method}`}
            label={t(`pos.method.${method}`)}
            defaultChecked={method === 'CASH' || enabled.has(method)}
            disabled={method === 'CASH'}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">{t('pos.settings.switches')}</legend>
        {SWITCHES.map(([key, label]) => (
          <Checkbox key={key} name={key} label={t(label)} defaultChecked={settings[key]} />
        ))}
      </fieldset>

      <Button type="submit" pending={form.pending} className="self-start">
        {t('common.save')}
      </Button>
    </form>
  );
}
