'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { createMenu } from '@/app/studio/_actions/menus';
import { LOCALES, type Locale } from '@/lib/locale';
import { suggestSlug } from '@/server/domain/slug';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { languageName } from '../menu-text';
import { SlugField } from '../SlugField';

export interface NewMenuFormProps {
  restaurants: ReadonlyArray<{ id: string; name: string; clientId: string; clientNumber: number }>;
  restaurantId: string;
  defaults: { locales: readonly string[]; defaultLocale: string; currency: string; timezone: string; numeralSystem: string };
  currencies: readonly string[];
  timeZones: readonly string[];
  origin: string;
}

/** The form's fields in their order, so a refusal's first field takes focus. */
const FIELDS = ['restaurantId', 'name', 'slug', 'locales', 'defaultLocale', 'currency', 'timezone', 'numeralSystem'];

/** One part of the form: its heading and what it is for on the start side, its fields beside them. */
function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-4 border-t border-line py-8 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        <p className="text-sm text-muted">{intro}</p>
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * A new menu. The address follows the name (and the restaurant's number when the name has no Latin letters) until the
 * person edits it, and is checked as it changes. Every field is held in state, so a refused form keeps what was typed.
 */
export function NewMenuForm({ restaurants, restaurantId, defaults, currencies, timeZones, origin }: NewMenuFormProps) {
  const t = useT();
  const router = useRouter();
  const [restaurant, setRestaurant] = useState(restaurantId);
  const [name, setName] = useState('');
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  const [locales, setLocales] = useState<string[]>([...defaults.locales]);
  const [defaultLocale, setDefaultLocale] = useState(defaults.defaultLocale);
  const [currency, setCurrency] = useState(defaults.currency);
  const [timezone, setTimezone] = useState(defaults.timezone);
  const [numerals, setNumerals] = useState(defaults.numeralSystem);

  const clientNumber = restaurants.find((option) => option.id === restaurant)?.clientNumber ?? 0;
  const slug = typedSlug ?? (name.trim() === '' ? '' : suggestSlug(name, `menu-${clientNumber}`));

  const form = useActionForm(
    (values) =>
      createMenu({
        restaurantId: values.restaurantId ?? '',
        name: values.name ?? '',
        slug: values.slug ?? '',
        locales: (values.locales ?? '').split(',').filter(Boolean),
        defaultLocale: values.defaultLocale ?? '',
        currency: values.currency ?? '',
        timezone: values.timezone ?? '',
        numeralSystem: values.numeralSystem ?? '',
      }),
    {
      validate: (values) => {
        const missing = requireFields(values, { name: t('error.text.menuNameEnter') });
        if ((values.locales ?? '') === '') missing.locales = t('error.text.languagesChoose');
        return missing;
      },
      onSuccess: ({ menuId }) => {
        toast.success(t('menus.form.created'));
        router.push(`/studio/menus/${menuId}`);
      },
    },
  );
  /** A field's message, including those about one of its parts (`locales.1`). */
  const errorOf = (field: string) => form.fieldError(field) ?? Object.entries(form.errors).find(([key]) => key.startsWith(`${field}.`))?.[1];

  const toggleLocale = (code: Locale, on: boolean) => {
    const next = LOCALES.filter((option) => (option === code ? on : locales.includes(option)));
    setLocales(next);
    if (!next.includes(defaultLocale as Locale) && next[0]) setDefaultLocale(next[0]);
  };

  return (
    <form {...form.props} className="flex max-w-6xl flex-col">
      <Section id="menu-basics" title={t('menus.form.basics')} intro={t('menus.form.basicsIntro')}>
        <Field label={t('menus.form.restaurant')} error={errorOf('restaurantId')}>
          <Select
            name="restaurantId"
            value={restaurant}
            onChange={(event) => setRestaurant(event.target.value)}
            options={restaurants.map((option) => ({ value: option.id, label: `${option.name} · ${option.clientId}` }))}
          />
        </Field>
        <Field label={t('menus.form.name')} hint={t('menus.form.nameHint')} error={errorOf('name')}>
          <Input name="name" autoComplete="off" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <SlugField value={slug} origin={origin} error={errorOf('slug')} onChange={setTypedSlug} />
      </Section>

      <Section id="menu-region" title={t('menus.form.region')} intro={t('menus.form.regionIntro')}>
        <fieldset aria-describedby={errorOf('locales') ? 'menu-locales-error' : undefined} className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-text">{t('menus.form.languages')}</legend>
          <input type="hidden" name="locales" value={locales.join(',')} />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {LOCALES.map((code) => (
              <Checkbox
                key={code}
                label={languageName(t, code)}
                checked={locales.includes(code)}
                onChange={(event) => toggleLocale(code, event.target.checked)}
              />
            ))}
          </div>
          {errorOf('locales') && (
            <p id="menu-locales-error" className="text-sm text-danger">
              {errorOf('locales')}
            </p>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('menus.form.defaultLanguage')} error={errorOf('defaultLocale')}>
            <Select
              name="defaultLocale"
              value={defaultLocale}
              onChange={(event) => setDefaultLocale(event.target.value)}
              options={(locales.length > 0 ? locales : [...LOCALES]).map((code) => ({ value: code, label: languageName(t, code) }))}
            />
          </Field>
          <Field label={t('menus.form.currency')} error={errorOf('currency')}>
            <Select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)} options={currencies.map((code) => ({ value: code, label: code }))} />
          </Field>
          <Field label={t('menus.form.timezone')} error={errorOf('timezone')}>
            <Select name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} options={timeZones.map((zone) => ({ value: zone, label: zone }))} />
          </Field>
          <Field label={t('menus.form.numerals')} error={errorOf('numeralSystem')}>
            <Select
              name="numeralSystem"
              value={numerals}
              onChange={(event) => setNumerals(event.target.value)}
              options={['LATN', 'ARAB'].map((system) => ({ value: system, label: t(`menus.numerals.${system}`) }))}
            />
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-line bg-bg py-3">
        <FormError form={form} fields={FIELDS} />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" pending={form.pending}>
            {form.pending ? t('menus.form.creating') : t('menus.form.create')}
          </Button>
        </div>
      </div>
    </form>
  );
}
