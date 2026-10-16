'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { updatePlatformSettings } from '@/app/studio/_actions/settings';
import { LOCALES, type Locale } from '@/lib/locale';
import type { PlatformSettings } from '@/server/domain/platform-settings';
import { formatDateTime } from '@/studio/format';
import { useActionForm } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { FormSection } from '@/studio/ui/FormSection';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';

export interface SettingsFormProps {
  settings: PlatformSettings;
  /** When any setting was last saved; null while all are the built-in defaults. */
  updatedAt: string | null;
  currencies: readonly string[];
  timeZones: readonly string[];
  /** The words that are reserved whatever the setting says. */
  builtIn: readonly string[];
}

/** The form's fields in their order, so a refusal's first field takes focus. */
const FIELDS = ['reservedSlugs', 'emailSenderName', 'defaults.locales', 'defaults.defaultLocale', 'defaults.currency', 'defaults.timezone'];

/** The words typed in the box: one per line (commas and semicolons separate them too). Spaces stay inside a word, which the server turns into hyphens. */
const wordsOf = (text: string) =>
  text
    .split(/[\n\r,;]+/)
    .map((word) => word.trim())
    .filter(Boolean);

/** An option list that always has the current value, even when it is not among the usual choices. */
function withCurrent(options: readonly string[], current: string): Array<{ value: string; label: string }> {
  return (options.includes(current) ? [...options] : [current, ...options]).map((value) => ({ value, label: value }));
}

/**
 * Platform settings: the words no menu may use as an address, the sender name of the Studio's emails, and what a new
 * menu starts with. One Save sends them all; the server says what changed and the log records it.
 */
export function SettingsForm({ settings, updatedAt, currencies, timeZones, builtIn }: SettingsFormProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [reserved, setReserved] = useState(settings.reservedSlugs.join('\n'));
  const [sender, setSender] = useState(settings.emailSenderName);
  const [locales, setLocales] = useState<string[]>([...settings.defaults.locales]);
  const [defaultLocale, setDefaultLocale] = useState<string>(settings.defaults.defaultLocale);
  const [currency, setCurrency] = useState(settings.defaults.currency);
  const [timezone, setTimezone] = useState(settings.defaults.timezone);

  const form = useActionForm(
    (values) =>
      updatePlatformSettings({
        reservedSlugs: wordsOf(values.reservedSlugs ?? ''),
        emailSenderName: values.emailSenderName ?? '',
        defaults: {
          locales: (values.locales ?? '').split(',').filter(Boolean),
          defaultLocale: values.defaultLocale ?? '',
          currency: values.currency ?? '',
          timezone: values.timezone ?? '',
        },
      }),
    {
      validate: (values) => (values.locales ? null : { 'defaults.locales': t('error.text.languagesChoose') }),
      onSuccess: ({ settings: saved, changed }) => {
        // What the server kept: the words cleaned the way addresses are, the name trimmed.
        setReserved(saved.reservedSlugs.join('\n'));
        setSender(saved.emailSenderName);
        toast.success(changed ? t('settings.saved') : t('settings.unchanged'));
        router.refresh();
      },
    },
  );
  /** A field's message, including those about one of its parts (`defaults.locales.1`). */
  const errorOf = (field: string) => form.fieldError(field) ?? Object.entries(form.errors).find(([key]) => key.startsWith(`${field}.`))?.[1];

  const toggleLocale = (code: Locale, on: boolean) => {
    const next = LOCALES.filter((option) => (option === code ? on : locales.includes(option)));
    setLocales(next);
    if (!next.includes(defaultLocale as Locale) && next[0]) setDefaultLocale(next[0]);
  };

  return (
    <form {...form.props} className="flex max-w-6xl flex-col">
      <FormSection id="settings-reserved" title={t('settings.reserved.title')} intro={t('settings.reserved.intro')}>
        <Field label={t('settings.reserved.label')} hint={t('settings.reserved.hint')} error={errorOf('reservedSlugs')}>
          <Textarea
            name="reservedSlugs"
            dir="ltr"
            rows={6}
            spellCheck={false}
            autoComplete="off"
            value={reserved}
            onChange={(event) => setReserved(event.target.value)}
            className="font-mono text-sm rtl:text-right"
          />
        </Field>
        <p className="text-sm text-muted">
          {t('settings.reserved.builtIn', { words: '' })}
          <bdi dir="ltr" className="font-mono text-xs">
            {builtIn.join(', ')}
          </bdi>
        </p>
      </FormSection>

      <FormSection id="settings-email" title={t('settings.email.title')} intro={t('settings.email.intro')}>
        <Field label={t('settings.email.name')} error={errorOf('emailSenderName')}>
          <Input name="emailSenderName" autoComplete="off" maxLength={60} value={sender} onChange={(event) => setSender(event.target.value)} />
        </Field>
      </FormSection>

      <FormSection id="settings-defaults" title={t('settings.defaults.title')} intro={t('settings.defaults.intro')}>
        <fieldset aria-describedby={errorOf('defaults.locales') ? 'settings-locales-error' : undefined} className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-text">{t('menus.form.languages')}</legend>
          <input type="hidden" name="locales" value={locales.join(',')} />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {LOCALES.map((code) => (
              <Checkbox
                key={code}
                label={t(`menus.language.${code}`)}
                checked={locales.includes(code)}
                onChange={(event) => toggleLocale(code, event.target.checked)}
              />
            ))}
          </div>
          {errorOf('defaults.locales') && (
            <p id="settings-locales-error" className="text-sm text-danger">
              {errorOf('defaults.locales')}
            </p>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('menus.form.defaultLanguage')} error={errorOf('defaults.defaultLocale')}>
            <Select
              name="defaultLocale"
              value={defaultLocale}
              onChange={(event) => setDefaultLocale(event.target.value)}
              options={(locales.length > 0 ? locales : [...LOCALES]).map((code) => ({ value: code, label: t(`menus.language.${code}`) }))}
            />
          </Field>
          <Field label={t('menus.form.currency')} error={errorOf('defaults.currency')}>
            <Select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)} options={withCurrent(currencies, currency)} />
          </Field>
          <Field label={t('menus.form.timezone')} error={errorOf('defaults.timezone')}>
            <Select name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} options={withCurrent(timeZones, timezone)} />
          </Field>
        </div>
      </FormSection>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-line bg-bg py-3">
        <FormError form={form} fields={FIELDS} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" variant="primary" pending={form.pending}>
            {form.pending ? t('common.saving') : t('settings.save')}
          </Button>
          <p className="text-sm text-muted">
            {updatedAt ? t('settings.lastSaved', { time: formatDateTime(updatedAt, locale) }) : t('settings.neverSaved')}
          </p>
        </div>
      </div>
    </form>
  );
}
