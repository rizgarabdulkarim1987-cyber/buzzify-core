'use client';

import { ImagePlus, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ChangeSlugDialog } from '@/app/studio/(studio)/(app)/menus/[id]/MenuActions';
import { updateMenuSettings } from '@/app/studio/_actions/menus';
import { LOCALES, type Locale } from '@/lib/locale';
import { minorUnitDigits, parsePriceInput, formatPriceInput, rescaleMinor } from '@/lib/money-input';
import type { MenuSettingsView } from '@/server/studio/services/menu-settings';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { formatMoney, isRtl, PRICE_PROBLEM_KEYS } from './content/shared';

const TITLE_MAX = 70;
const DESCRIPTION_MAX = 200;

type SeoDraft = Partial<Record<Locale, { title: string; description: string; imageAssetId?: string; imageUrl: string | null }>>;

/** One part of the form: its heading and a sentence on the start side, its fields beside. */
function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-4 border-t border-line py-8 first:border-t-0 first:pt-2 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-4">{children}</div>
    </section>
  );
}

/** A count of typed characters against the limit, quiet until it gets close. */
function Counter({ length, max }: { length: number; max: number }) {
  return (
    <span dir="ltr" className={cx('tabular-nums', length > max ? 'text-danger' : length > max * 0.9 ? 'text-text' : 'text-muted')}>
      {length}/{max}
    </span>
  );
}

export interface SettingsFormProps {
  menuId: string;
  restaurantId: string;
  origin: string;
  settings: MenuSettingsView;
  currencies: readonly string[];
  timeZones: readonly string[];
}

/**
 * The Settings tab (spec 10.3): the menu's name and address, its languages and region, the rounding step of bulk price
 * changes, the search text of each language and the notes. Saved together at the menu's version; a currency with other
 * decimals asks for a confirmation that shows what happens to a price.
 */
export function SettingsForm({ menuId, restaurantId, origin, settings, currencies, timeZones }: SettingsFormProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [name, setName] = useState(settings.name);
  const [locales, setLocales] = useState<Locale[]>(settings.locales);
  const [defaultLocale, setDefaultLocale] = useState<Locale>(settings.defaultLocale);
  const [currency, setCurrency] = useState(settings.currency);
  const [confirmCurrency, setConfirmCurrency] = useState(false);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [numerals, setNumerals] = useState(settings.numeralSystem);
  const [step, setStep] = useState(settings.priceStep === null ? '' : formatPriceInput(settings.priceStep, settings.currency));
  const [seo, setSeo] = useState<SeoDraft>(settings.seo);
  const [notes, setNotes] = useState(settings.notes);
  const [picking, setPicking] = useState<Locale | null>(null);
  const [slugOpen, setSlugOpen] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string; fields: Record<string, string>; attempt: number } | null>(null);
  const [saving, startSaving] = useTransition();

  const digitsChange = minorUnitDigits(currency) !== minorUnitDigits(settings.currency);
  const sample = minorUnitDigits(settings.currency) === 0 ? 6000 : 450;
  const example = t('menuSettings.currency.example', {
    before: formatMoney(sample, settings.currency, locale),
    after: formatMoney(rescaleMinor(sample, minorUnitDigits(settings.currency), minorUnitDigits(currency)), currency, locale),
  });
  const errors = failure?.fields ?? {};

  const toggleLocale = (code: Locale, on: boolean) => {
    const next = LOCALES.filter((entry) => (entry === code ? on : locales.includes(entry)));
    setLocales(next);
    if (!next.includes(defaultLocale) && next[0]) setDefaultLocale(next[0]);
  };
  const updateSeo = (code: Locale, change: Partial<NonNullable<SeoDraft[Locale]>>) =>
    setSeo((current) => ({ ...current, [code]: { title: '', description: '', imageUrl: null, ...current[code], ...change } }));

  const save = () =>
    startSaving(async () => {
      const attempt = (failure?.attempt ?? 0) + 1;
      // The step is typed in the menu's currency as it stands; a converted currency converts it with the prices.
      let priceStep: number | null = null;
      if (step.trim() !== '') {
        const parsed = parsePriceInput(step, settings.currency);
        if (!parsed.ok || parsed.minor === 0) {
          setFailure({ code: 'INVALID', message: t('error.INVALID'), fields: { priceStep: t(parsed.ok ? 'menuSettings.step.zero' : PRICE_PROBLEM_KEYS[parsed.reason]) }, attempt });
          return;
        }
        priceStep = parsed.minor;
      }
      const result = await updateMenuSettings({
        menuId,
        version: settings.version,
        name,
        locales,
        defaultLocale,
        currency,
        ...(digitsChange ? { confirmCurrencyChange: confirmCurrency } : {}),
        timezone,
        numeralSystem: numerals,
        seo: Object.fromEntries(
          locales.flatMap((code) => {
            const entry = seo[code];
            if (!entry) return [];
            return [[code, { title: entry.title, description: entry.description, ...(entry.imageAssetId ? { imageAssetId: entry.imageAssetId } : {}) }]];
          }),
        ),
        notes,
        priceStep,
      });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        setFailure({ code: result.error.code, message: described.message, fields: described.fields, attempt });
        return;
      }
      setFailure(null);
      setConfirmCurrency(false);
      toast.success(result.data.rescaled > 0 ? t('menuSettings.savedRescaled', { count: result.data.rescaled }) : t('menuSettings.saved'));
      router.refresh();
    });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex max-w-6xl flex-col px-8 pb-0 pt-6"
    >
      <Section id="settings-name" title={t('menuSettings.basics')} intro={t('menuSettings.basicsIntro')}>
        <Field label={t('menus.form.name')} error={errors.name}>
          <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">{t('menuSettings.address')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-sm text-text">
              {origin.replace(/^https?:\/\//, '')}/{settings.slug}
            </span>
            <Button size="sm" icon={<Pencil aria-hidden />} onClick={() => setSlugOpen(true)}>
              {t('menuSettings.changeAddress')}
            </Button>
          </div>
          {settings.formerSlugs.length > 0 && (
            <p className="text-sm text-muted">
              {t('menus.address.former')}{' '}
              {settings.formerSlugs.map((slug, index) => (
                <span key={slug}>
                  {index > 0 && ', '}
                  <bdi dir="ltr" className="font-mono">
                    /{slug}
                  </bdi>
                </span>
              ))}
            </p>
          )}
        </div>
      </Section>

      <Section id="settings-region" title={t('menus.form.region')} intro={t('menuSettings.regionIntro')}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-text">{t('menus.form.languages')}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {LOCALES.map((code) => (
              <Checkbox
                key={code}
                label={t(`menus.language.${code}`)}
                checked={locales.includes(code)}
                disabled={locales.length === 1 && locales.includes(code)}
                onChange={(event) => toggleLocale(code, event.target.checked)}
              />
            ))}
          </div>
          <p className="text-sm text-muted">{t('menuSettings.languagesHint')}</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('menus.form.defaultLanguage')} error={errors.defaultLocale}>
            <Select
              value={defaultLocale}
              onChange={(event) => setDefaultLocale(event.target.value as Locale)}
              options={locales.map((code) => ({ value: code, label: t(`menus.language.${code}`) }))}
            />
          </Field>
          <Field label={t('menus.form.currency')} error={errors.currency}>
            <Select
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value);
                setConfirmCurrency(false);
              }}
              options={currencies.map((code) => ({ value: code, label: code }))}
            />
          </Field>
          <Field label={t('menus.form.timezone')} error={errors.timezone}>
            <Select value={timezone} onChange={(event) => setTimezone(event.target.value)} options={timeZones.map((zone) => ({ value: zone, label: zone }))} />
          </Field>
          <Field label={t('menus.form.numerals')} error={errors.numeralSystem}>
            <Select
              value={numerals}
              onChange={(event) => setNumerals(event.target.value as 'LATN' | 'ARAB')}
              options={['LATN', 'ARAB'].map((system) => ({ value: system, label: t(`menus.numerals.${system}`) }))}
            />
          </Field>
        </div>
        {digitsChange && (
          <Alert tone="neutral">
            <div className="flex flex-col gap-2">
              <span>{t('menuSettings.currency.warning', { from: settings.currency, to: currency })}</span>
              <span className="font-medium">{example}</span>
              <Checkbox label={t('menuSettings.currency.confirm')} checked={confirmCurrency} onChange={(event) => setConfirmCurrency(event.target.checked)} />
            </div>
          </Alert>
        )}
      </Section>

      <Section id="settings-prices" title={t('menuSettings.step.title')} intro={t('menuSettings.step.intro')}>
        <Field
          label={t('menuSettings.step.label', { currency: settings.currency })}
          hint={t('menuSettings.step.hint', { step: formatMoney(settings.defaultStep, settings.currency, locale) })}
          error={errors.priceStep}
          optional
          className="max-w-56"
        >
          <Input
            value={step}
            inputMode="decimal"
            dir="ltr"
            placeholder={formatPriceInput(settings.defaultStep, settings.currency)}
            onChange={(event) => setStep(event.target.value)}
            className="tabular-nums"
          />
        </Field>
      </Section>

      <Section id="settings-seo" title={t('menuSettings.seo.title')} intro={t('menuSettings.seo.intro')}>
        {locales.map((code) => {
          const entry = seo[code] ?? { title: '', description: '', imageUrl: null };
          const language = t(`menus.language.${code}`);
          const rtl = isRtl(code);
          return (
            <fieldset key={code} className="flex flex-col gap-3 rounded-md border border-line p-4">
              <legend className="px-1 text-sm font-medium text-text">{language}</legend>
              <Field
                label={t('menuSettings.seo.pageTitle')}
                aside={<Counter length={entry.title.length} max={TITLE_MAX} />}
                error={errors[`seo.${code}.title`]}
              >
                <Input
                  value={entry.title}
                  lang={code}
                  dir={rtl ? 'rtl' : 'ltr'}
                  aria-label={t('content.inLanguage', { field: t('menuSettings.seo.pageTitle'), language })}
                  className={cx(rtl && 's-script-arabic font-sans')}
                  onChange={(event) => updateSeo(code, { title: event.target.value })}
                />
              </Field>
              <Field
                label={t('menuSettings.seo.description')}
                aside={<Counter length={entry.description.length} max={DESCRIPTION_MAX} />}
                error={errors[`seo.${code}.description`]}
              >
                <Textarea
                  rows={2}
                  value={entry.description}
                  lang={code}
                  dir={rtl ? 'rtl' : 'ltr'}
                  aria-label={t('content.inLanguage', { field: t('menuSettings.seo.description'), language })}
                  className={cx(rtl && 's-script-arabic font-sans')}
                  onChange={(event) => updateSeo(code, { description: event.target.value })}
                />
              </Field>
              <div className="flex items-center gap-3">
                {entry.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail
                  <img src={entry.imageUrl} alt="" className="h-16 w-[122px] rounded-md border border-line object-cover" />
                ) : (
                  <span className="flex h-16 w-[122px] items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted">
                    {t('menuSettings.seo.noImage')}
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-text">{t('menuSettings.seo.image')}</span>
                  <div className="flex gap-1">
                    <Button size="sm" icon={<ImagePlus aria-hidden />} onClick={() => setPicking(code)} aria-label={t('menuSettings.seo.chooseLabel', { language })}>
                      {t('menuSettings.seo.choose')}
                    </Button>
                    {entry.imageAssetId && (
                      <IconButton
                        size="sm"
                        icon={<Trash2 aria-hidden />}
                        label={t('menuSettings.seo.removeLabel', { language })}
                        onClick={() => updateSeo(code, { imageAssetId: undefined, imageUrl: null })}
                      />
                    )}
                  </div>
                </div>
              </div>
            </fieldset>
          );
        })}
      </Section>

      <Section id="settings-notes" title={t('menuSettings.notes.title')} intro={t('menuSettings.notes.intro')}>
        <Field label={t('menuSettings.notes.label')} hideLabel error={errors.notes}>
          <Textarea rows={4} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-line bg-bg py-3">
        {failure && (
          <Alert key={failure.attempt} tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{failure.message}</span>
              {failure.code === 'CONFLICT' && (
                <Button size="sm" icon={<RotateCw aria-hidden />} onClick={() => window.location.reload()}>
                  {t('content.drawer.reload')}
                </Button>
              )}
            </div>
          </Alert>
        )}
        <div>
          <Button type="submit" variant="primary" pending={saving} disabled={digitsChange && !confirmCurrency}>
            {t('menuSettings.save')}
          </Button>
        </div>
      </div>

      <MediaPicker
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        restaurantId={restaurantId}
        onPick={(items) => {
          const [first] = items;
          if (picking && first) updateSeo(picking, { imageAssetId: first.assetId, imageUrl: first.thumbUrl });
        }}
      />
      {slugOpen && (
        <ChangeSlugDialog
          menu={{ id: menuId, name: settings.name, slug: settings.slug, version: settings.version }}
          origin={origin}
          onClose={() => setSlugOpen(false)}
        />
      )}
    </form>
  );
}
