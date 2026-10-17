'use client';

import type { Locale } from '@/lib/locale';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';
import { isRtl, type Names } from './shared';

export interface TranslationFieldsProps {
  /** What the text is ("Name", "Size 1 name"): each input is called "{label} ({language})". */
  label: string;
  locales: readonly Locale[];
  values: Names;
  onChange: (values: Names) => void;
  /** Messages by language. */
  errors?: Partial<Record<Locale, string>>;
  multiline?: boolean;
  maxLength?: number;
  /** Shows the label above the inputs; off where a heading or column already says it. */
  showLabel?: boolean;
  /** Languages whose text the menu still lacks are marked, so the person sees what guests would miss. */
  markMissing?: boolean;
  className?: string;
}

/**
 * One text in each of the menu's languages, side by side. Each input carries its language (`lang`) and direction:
 * Arabic and Sorani are written right to left in the Arabic-script face, whatever the Studio's own language.
 */
export function TranslationFields({
  label,
  locales,
  values,
  onChange,
  errors = {},
  multiline = false,
  maxLength,
  showLabel = true,
  markMissing = false,
  className,
}: TranslationFieldsProps) {
  const t = useT();
  return (
    <fieldset className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <legend className={cx('mb-1.5 text-sm font-medium text-text', !showLabel && 'sr-only')}>{label}</legend>
      <div className={cx('grid gap-3', locales.length > 1 && 'sm:grid-cols-[repeat(var(--columns),minmax(0,1fr))]')} style={{ ['--columns' as string]: locales.length }}>
        {locales.map((locale) => {
          const language = t(`menus.language.${locale}`);
          const value = values[locale] ?? '';
          const missing = markMissing && value.trim() === '';
          const props = {
            value,
            lang: locale,
            dir: isRtl(locale) ? ('rtl' as const) : ('ltr' as const),
            maxLength,
            'aria-label': t('content.inLanguage', { field: label, language }),
            className: cx(isRtl(locale) && 's-script-arabic font-sans'),
            onChange: (event: { target: { value: string } }) => onChange({ ...values, [locale]: event.target.value }),
          };
          return (
            <Field
              key={locale}
              label={
                <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted">
                  {language}
                  {missing && <span className="rounded-sm bg-accent-wash px-1 text-xs text-text">{t('content.missing')}</span>}
                </span>
              }
              error={errors[locale]}
            >
              {multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
            </Field>
          );
        })}
      </div>
    </fieldset>
  );
}
