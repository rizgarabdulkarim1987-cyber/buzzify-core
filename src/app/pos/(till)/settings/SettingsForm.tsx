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
import { Select } from '@/studio/ui/Select';

const SWITCHES = [
  ['kitchenPrintEnabled', 'pos.settings.kitchenPrint'],
  ['kitchenScreenEnabled', 'pos.settings.kitchenScreen'],
  ['qrOrderingEnabled', 'pos.settings.qrOrdering'],
  ['takeawayEnabled', 'pos.settings.takeaway'],
  ['deliveryEnabled', 'pos.settings.delivery'],
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
        idleMinutes: whole(values.idleMinutes),
        roundingStep: whole(values.roundingStep),
        usdEnabled: values.usdEnabled === 'on',
        usdRate: whole(values.usdRate || '0'),
        invoiceName: values.invoiceName ?? '',
        invoiceAddress: values.invoiceAddress ?? '',
        invoicePhone: values.invoicePhone ?? '',
        invoiceTaxNumber: values.invoiceTaxNumber ?? '',
        invoiceFooter: values.invoiceFooter ?? '',
        requireApproval: values.requireApproval === 'on',
        // Cash is always sent: its box is checked and disabled, and a disabled field is not part of the form.
        enabledPaymentMethods: POS_PAYMENT_METHODS.filter((method) => method === 'CASH' || values[`method.${method}`] === 'on'),
        ...Object.fromEntries(SWITCHES.map(([key]) => [key, values[key] === 'on'])),
        // Guests no longer read this one (a menu's own switch decides), so the screen keeps what is stored.
        complaintsEnabled: settings.complaintsEnabled,
        version: settings.version,
      }),
    {
      keep: ['serviceRatePercent', 'taxRatePercent', 'tableRingMinutes', 'idleMinutes', 'usdRate', 'invoiceName', 'invoiceAddress', 'invoicePhone', 'invoiceTaxNumber', 'invoiceFooter'],
      onSuccess: () => {
        toast.success(t('pos.settings.saved'));
        router.refresh();
      },
    },
  );
  const enabled = new Set<PosPaymentMethodKey>(settings.enabledPaymentMethods);

  return (
    <form key={settings.version} {...form.props} className="flex max-w-2xl flex-col gap-6 rounded-[28px] border border-line bg-surface p-6">
      <FormError form={form} fields={['serviceRatePercent', 'taxRatePercent', 'tableRingMinutes', 'idleMinutes', 'roundingStep', 'usdRate', 'enabledPaymentMethods']} />
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
        <Field label={t('pos.settings.idle')} hint={t('pos.settings.idleHint')} error={form.fieldError('idleMinutes')}>
          <Input name="idleMinutes" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={form.value('idleMinutes') ?? String(settings.idleMinutes)} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-bold text-text">{t('pos.settings.rounding')}</legend>
        <Field label={t('pos.settings.rounding')} hint={t('pos.settings.roundingHint')} error={form.fieldError('roundingStep')}>
          <Select
            name="roundingStep"
            defaultValue={form.value('roundingStep') ?? String(settings.roundingStep)}
            options={[
              { value: '0', label: t('pos.settings.roundingOff') },
              ...[250, 500, 1000].map((step) => ({ value: String(step), label: String(step) })),
            ]}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-bold text-text">{t('pos.settings.currency')}</legend>
        <Checkbox name="usdEnabled" label={t('pos.settings.usd')} defaultChecked={settings.usdEnabled} />
        <Field label={t('pos.settings.usdRate')} hint={t('pos.settings.usdHint')} error={form.fieldError('usdRate')}>
          <Input name="usdRate" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={form.value('usdRate') ?? String(settings.usdRate)} />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-bold text-text">{t('pos.settings.invoice')}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pos.settings.invoiceName')} error={form.fieldError('invoiceName')}>
            <Input name="invoiceName" maxLength={120} defaultValue={form.value('invoiceName') ?? settings.invoiceName} />
          </Field>
          <Field label={t('pos.settings.invoicePhone')} error={form.fieldError('invoicePhone')}>
            <Input name="invoicePhone" dir="ltr" className="rtl:text-right" maxLength={120} defaultValue={form.value('invoicePhone') ?? settings.invoicePhone} />
          </Field>
          <Field label={t('pos.settings.invoiceAddress')} error={form.fieldError('invoiceAddress')}>
            <Input name="invoiceAddress" maxLength={120} defaultValue={form.value('invoiceAddress') ?? settings.invoiceAddress} />
          </Field>
          <Field label={t('pos.settings.invoiceTaxNumber')} error={form.fieldError('invoiceTaxNumber')}>
            <Input name="invoiceTaxNumber" dir="ltr" className="rtl:text-right" maxLength={120} defaultValue={form.value('invoiceTaxNumber') ?? settings.invoiceTaxNumber} />
          </Field>
        </div>
        <Field label={t('pos.settings.invoiceFooter')} error={form.fieldError('invoiceFooter')}>
          <Input name="invoiceFooter" maxLength={120} defaultValue={form.value('invoiceFooter') ?? settings.invoiceFooter} />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-lg font-bold text-text">{t('pos.settings.trust')}</legend>
        <Checkbox name="requireApproval" label={t('pos.settings.requireApproval')} defaultChecked={settings.requireApproval} />
        <p className="text-sm text-muted">{t('pos.settings.requireApprovalHint')}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-lg font-bold text-text">{t('pos.settings.methods')}</legend>
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
        <legend className="text-lg font-bold text-text">{t('pos.settings.switches')}</legend>
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
