'use client';

import { CircleCheck } from 'lucide-react';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { slugAvailability } from '@/app/studio/_actions/menus';
import { normalizeSlugInput } from '@/server/domain/slug';
import type { SlugAvailability } from '@/server/studio/services/menus';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { CONTROL_CLASSES, CONTROL_HEIGHTS, Field, useFieldProps } from '@/studio/ui/Field';
import { slugStatusText } from './menu-text';

/** How long typing has to pause before the address is checked. */
const CHECK_DELAY_MS = 300;

/**
 * Lowers and hyphenates as the person types, keeping a hyphen at the end (they may be typing the next word). The full
 * clean-up (`normalizeSlugInput`) runs when they leave the field.
 */
const shapeWhileTyping = (raw: string) => raw.toLowerCase().replace(/[\s_]+/g, '-');

/** Whether an address can be had, as the server answers for what is typed now; null before the first answer. */
function useSlugCheck(slug: string, menuId: string | undefined): { slug: string; status: SlugAvailability } | null {
  const [answer, setAnswer] = useState<{ slug: string; status: SlugAvailability } | null>(null);
  useEffect(() => {
    if (slug === '') return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await slugAvailability({ slug, ...(menuId ? { menuId } : {}) });
      // An answer for something typed before is not this one's.
      if (current && result.ok) setAnswer(result.data);
    }, CHECK_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [slug, menuId]);
  return answer;
}

/** The input, with the public origin before it: the whole address reads left to right in every language. */
function SlugInput({ origin, ...rest }: { origin: string } & InputHTMLAttributes<HTMLInputElement>) {
  const field = useFieldProps();
  return (
    <div dir="ltr" className={cx(CONTROL_CLASSES, 'flex items-center overflow-hidden focus-within:border-ink', field['aria-invalid'] && 'border-danger')}>
      <span aria-hidden className="shrink-0 select-none ps-2.5 font-mono text-sm text-muted">
        {origin.replace(/^https?:\/\//, '')}/
      </span>
      <input
        {...field}
        {...rest}
        dir="ltr"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className={cx(CONTROL_HEIGHTS.md, 'min-w-0 flex-1 bg-transparent ps-0.5 font-mono text-sm text-text outline-none')}
      />
    </div>
  );
}

export interface SlugFieldProps {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  /** The public origin, shown before the address. */
  origin: string;
  /** For an existing menu: its own addresses, current and former, count as available. */
  menuId?: string;
  /** The address the menu has now, which needs no check. */
  current?: string;
  /** The server's refusal of the last submit, which wins over the live check. */
  error?: string;
  autoFocus?: boolean;
}

/**
 * An address for a menu, checked as the person types (after a short pause): available, taken, reserved, or not in slug
 * syntax, said under the field. The server checks again when the form is sent.
 */
export function SlugField({ name = 'slug', value, onChange, origin, menuId, current, error, autoFocus }: SlugFieldProps) {
  const t = useT();
  const answer = useSlugCheck(value === current ? '' : value, menuId);
  const known = answer !== null && answer.slug === value;
  const unchanged = value === current || value === '';

  let problem: string | undefined = error;
  let hint: ReactNode = t('menus.slug.hint');
  if (!problem && !unchanged) {
    if (!known) hint = <span aria-live="polite">{t('menus.slug.checking')}</span>;
    else if (answer.status === 'ok')
      hint = (
        <span aria-live="polite" className="inline-flex items-center gap-1.5 text-success">
          <CircleCheck aria-hidden className="size-3.5" />
          {t('menus.slug.available')}
        </span>
      );
    else problem = slugStatusText(t, answer.status);
  }

  return (
    <Field label={t('menus.slug.label')} hint={hint} error={problem}>
      <SlugInput
        origin={origin}
        name={name}
        value={value}
        maxLength={60}
        autoFocus={autoFocus}
        onChange={(event) => onChange(shapeWhileTyping(event.target.value))}
        onBlur={(event) => onChange(normalizeSlugInput(event.target.value))}
      />
    </Field>
  );
}
