'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { resetAppearance, setAppearance } from '@/app/studio/_actions/account';
import {
  checkAppearance,
  DEFAULT_APPEARANCE,
  FONT_KEYS,
  FONTS,
  fullAppearanceVars,
  PRESETS,
  SHAPES,
  type Appearance,
} from '@/lib/appearance';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

const COLOUR_FIELDS = ['bg', 'text', 'button', 'buttonText'] as const;
type ColourField = (typeof COLOUR_FIELDS)[number];

/** A colour that is not yet a whole `#rrggbb` is still being typed; the preview keeps the last whole one. */
const WHOLE = /^#[0-9a-fA-F]{6}$/;

/**
 * Your own look for the Studio and the till: font, four colours and the shape of the buttons. Only the signed-in person
 * sees the result. A choice that cannot be read (text on its own background, a button that disappears) is explained
 * beside its field and cannot be saved. No motion: the preview changes at once.
 */
export function AppearanceForm({ initial }: { initial: Appearance }) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<Appearance>(initial);
  const [pending, start] = useTransition();

  const checked = checkAppearance(draft);
  const errorOf = (field: ColourField): string | undefined => {
    if (checked.ok || checked.field !== field) return undefined;
    return field === 'text' && checked.code === 'contrast'
      ? t('account.appearance.error.text')
      : field === 'buttonText' && checked.code === 'contrast'
        ? t('account.appearance.error.buttonText')
        : field === 'button' && checked.code === 'contrast'
          ? t('account.appearance.error.button')
          : t('account.appearance.error.format');
  };

  const previewSource = checked.ok ? checked.value : { ...DEFAULT_APPEARANCE, ...Object.fromEntries(Object.entries(draft).filter(([k, v]) => !COLOUR_FIELDS.includes(k as ColourField) || WHOLE.test(v as string))) };
  const previewVars = fullAppearanceVars(previewSource as Appearance) as CSSProperties;

  const save = () => {
    if (!checked.ok) return;
    start(async () => {
      const result = await setAppearance(checked.value);
      if (result.ok) {
        toast.success(t('account.appearance.saved'));
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  };

  const reset = () => {
    start(async () => {
      const result = await resetAppearance(undefined);
      if (result.ok) {
        setDraft(DEFAULT_APPEARANCE);
        toast.success(t('account.appearance.resetDone'));
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  };

  const colourLabel: Record<ColourField, string> = {
    bg: t('account.appearance.bg'),
    text: t('account.appearance.text'),
    button: t('account.appearance.button'),
    buttonText: t('account.appearance.buttonText'),
  };

  return (
    <div className="grid max-w-3xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-text">{t('account.appearance.presets')}</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button key={preset.key} size="sm" onClick={() => setDraft(preset.appearance)}>
                {t(`account.appearance.preset.${preset.key}`)}
              </Button>
            ))}
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">{t('account.appearance.font')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {FONT_KEYS.map((key) => (
              <label
                key={key}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-base',
                  draft.font === key ? 'border-ink bg-hover' : 'border-line-strong hover:bg-hover',
                )}
                style={FONTS[key].stack ? { fontFamily: FONTS[key].stack } : undefined}
              >
                <input type="radio" name="font" value={key} checked={draft.font === key} onChange={() => setDraft({ ...draft, font: key })} className="accent-ink" />
                {t(`account.appearance.font.${key}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {COLOUR_FIELDS.map((name) => (
            <Field key={name} label={colourLabel[name]} error={errorOf(name)}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={colourLabel[name]}
                  value={WHOLE.test(draft[name]) ? draft[name] : DEFAULT_APPEARANCE[name]}
                  onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-line-strong bg-raised p-0.5"
                />
                <Input
                  name={name}
                  dir="ltr"
                  spellCheck={false}
                  autoComplete="off"
                  value={draft[name]}
                  onChange={(event) => setDraft({ ...draft, [name]: event.target.value.trim() })}
                />
              </div>
            </Field>
          ))}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">{t('account.appearance.shape')}</legend>
          <div className="flex gap-2">
            {SHAPES.map((shape) => (
              <label
                key={shape}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-base',
                  draft.shape === shape ? 'border-ink bg-hover' : 'border-line-strong hover:bg-hover',
                )}
              >
                <input type="radio" name="shape" value={shape} checked={draft.shape === shape} onChange={() => setDraft({ ...draft, shape })} className="accent-ink" />
                {t(`account.appearance.shape.${shape}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={!checked.ok} pending={pending}>
            {t('account.appearance.save')}
          </Button>
          <Button onClick={reset} disabled={pending}>
            {t('account.appearance.reset')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-text">{t('account.appearance.preview')}</p>
        <div
          data-preview
          className="flex flex-col gap-3 rounded-lg border p-4"
          // The preview paints with its own copy of the variables, so it shows the draft whatever the page itself wears.
          style={{ ...previewVars, background: 'var(--s-bg)', color: 'var(--s-text)', borderColor: 'var(--s-line-strong)', fontFamily: 'var(--s-font)' }}
        >
          <p className="text-md font-semibold">{t('account.appearance.previewHeading')}</p>
          <p className="text-sm" style={{ color: 'var(--s-muted)' }}>
            {t('account.appearance.previewBody')}
          </p>
          <div className="flex gap-2">
            <span className="inline-flex h-8 items-center px-3 text-base font-medium" style={{ background: 'var(--s-ink)', color: 'var(--s-on-ink)', borderRadius: 'var(--s-btn-radius)' }}>
              {t('account.appearance.previewPrimary')}
            </span>
            <span className="inline-flex h-8 items-center border px-3 text-base font-medium" style={{ borderColor: 'var(--s-line-strong)', background: 'var(--s-raised)', borderRadius: 'var(--s-btn-radius)' }}>
              {t('account.appearance.previewSecondary')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
