'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { isLocale, type Locale } from '@/lib/locale';
import type { FeatureKey } from '@/server/domain/entitlements';
import { DAYPARTS, type Daypart } from '@/server/domain/types';
import type { ActionResult } from '@/server/studio/framework/result';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import type { SalesRules } from '@/server/studio/services/sales';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { IconButton } from '@/studio/ui/IconButton';
import { Select, type SelectOption } from '@/studio/ui/Select';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';
import { displayName, type Names } from '../content/shared';

/** The pieces the Sales tab's pages share (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.4). */

export type RulesView = SalesRules & { upgrade: UpgradeInfo };

/** Western digits for Arabic-Indic and Persian ones, so a number typed on an Arabic keyboard reads. */
export function latinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

/** A row's name in the person's language, falling back to the menu's own. */
export function useNamer(defaultLocale: string): (names: Names) => string {
  const { locale } = useLocale();
  const fallback: Locale = isLocale(defaultLocale) ? defaultLocale : 'en';
  return useCallback((names: Names) => displayName(names, locale, fallback), [locale, fallback]);
}

/**
 * Sends a save: on success the page's data is read again and `onSaved` runs; a refusal gives its field messages back
 * (by the server's field paths) or, when it names no field, shows its sentence.
 * A save sent with no dialog open (`inline: false`, e.g. a row's switch) has nowhere to show field messages, so the
 * first one is shown as a toast instead.
 */
export function useSave() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useCallback(
    async (send: () => Promise<ActionResult<unknown>>, onSaved?: () => void, savedMessage = t('sales.saved'), { inline = true }: { inline?: boolean } = {}) => {
      setPending(true);
      const result = await send();
      setPending(false);
      if (result.ok) {
        setErrors({});
        toast.success(savedMessage);
        onSaved?.();
        router.refresh();
        return true;
      }
      const described = describeFailure(t, locale, result.error);
      const fieldMessages = Object.values(described.fields);
      if (inline && fieldMessages.length > 0) setErrors(described.fields);
      else toast.error(fieldMessages[0] ?? described.message);
      return false;
    },
    [t, locale, router],
  );
  return { pending, errors, setErrors, save };
}

/** What a page says when the restaurant's plan leaves its tool out: the rules stay readable, nothing can be changed. */
export function Locked({ feature, upgrade, children }: { feature: FeatureKey; upgrade: UpgradeInfo; children?: ReactNode }) {
  const t = useT();
  if (upgrade.allowed.includes(feature)) return null;
  return (
    <Alert tone="neutral">
      <div className="flex flex-col gap-2">
        <span>{children ?? t('sales.locked')}</span>
        <UpgradeHint feature={feature} info={upgrade} />
      </div>
    </Alert>
  );
}

/** A page's opening: what the tool does and why it sells, and its main action. */
export function PageIntro({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex max-w-[65ch] flex-col gap-1">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        <p className="text-sm text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

/** The times of day a rule runs at, as toggles; none chosen means all day. */
export function DaypartToggles({ value, onChange, error }: { value: Daypart[]; onChange: (next: Daypart[]) => void; error?: string | undefined }) {
  const t = useT();
  const chosen = new Set(value);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-text">{t('sales.dayparts')}</legend>
      <div className="flex flex-wrap gap-1.5">
        {DAYPARTS.map((daypart) => {
          const on = chosen.has(daypart);
          return (
            <button
              key={daypart}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(DAYPARTS.filter((d) => (d === daypart ? !on : chosen.has(d))))}
              className={cx(
                'h-8 rounded-md border px-3 text-sm transition-colors',
                on ? 'border-text bg-text text-bg' : 'border-line bg-surface text-text hover:border-muted',
              )}
            >
              {t(`sales.daypart.${daypart}`)}
            </button>
          );
        })}
      </div>
      <p className={cx('text-sm', error ? 'text-danger' : 'text-muted')}>{error ?? (value.length === 0 ? t('sales.dayparts.all') : t('sales.dayparts.some'))}</p>
    </fieldset>
  );
}

/** The menu's dishes as select options, each after its category's name, in menu order. */
export function dishOptions(rules: Pick<SalesRules, 'products' | 'categories'>, name: (names: Names) => string): SelectOption[] {
  const categories = new Map(rules.categories.map((category) => [category.id, name(category.names)]));
  return rules.products.map((product) => ({ value: product.id, label: `${categories.get(product.categoryId) ?? ''} · ${name(product.names)}` }));
}

/** A select of the menu's dishes that starts with "Choose a dish". */
export function DishSelect({
  options,
  value,
  onChange,
  invalid,
}: {
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
}) {
  const t = useT();
  return (
    <Select
      options={[{ value: '', label: t('sales.chooseDish'), disabled: true }, ...options]}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export { strengthLevel } from './levels';

/** Normal, high or top, for an upgrade's priority or a pairing's strength. */
export function strengthOptions(t: (key: string) => string): SelectOption[] {
  return [50, 75, 100].map((level) => ({ value: String(level), label: t(`content.priority.${level}`) }));
}

/** One rule in a page's list: what it does, its details, whether it is on, and its edit and delete buttons. */
export function RuleRow({
  title,
  details,
  isActive,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  readOnly,
  extra,
  stateLabel,
  stateTone,
}: {
  title: ReactNode;
  details: ReactNode;
  isActive: boolean;
  /** A state that says more than on or off, such as an offer past its end date. */
  stateLabel?: string;
  /** The badge's tone when `stateLabel` is given; grey unless said otherwise. */
  stateTone?: StatusTone;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  readOnly: boolean;
  extra?: ReactNode;
}) {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className={cx('flex min-w-0 flex-1 flex-col gap-0.5', !isActive && 'opacity-60')}>
        <span className="text-base font-medium text-text">{title}</span>
        <span className="text-sm text-muted">{details}</span>
      </div>
      <StatusBadge tone={stateLabel ? (stateTone ?? 'neutral') : isActive ? 'success' : 'neutral'}>{stateLabel ?? (isActive ? t('sales.on') : t('sales.off'))}</StatusBadge>
      {extra}
      {!readOnly && (
        <span className="flex items-center gap-1">
          <Button size="sm" variant="secondary" icon={<Pencil aria-hidden />} onClick={onEdit} aria-label={editLabel}>
            {t('sales.edit')}
          </Button>
          <IconButton label={deleteLabel} icon={<Trash2 aria-hidden />} size="sm" onClick={onDelete} />
        </span>
      )}
    </li>
  );
}

/** The list a page's rules sit in. */
export function RuleList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="divide-y divide-line rounded-lg border border-line bg-raised">
      {children}
    </ul>
  );
}

/** Every weekday: bit 0 is Monday, as in the daypart schedule. */
export const ALL_DAYS = 127;
export const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Minutes after midnight as `HH:MM`, or empty for none. */
export const clock = (minute: number | null) => (minute === null ? '' : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);

/** `HH:MM` as minutes after midnight, or null when empty or unreadable. */
export function minuteOf(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The days of the week a rule runs on, as toggles over a weekday bitmask. */
export function WeekdayToggles({ value, onChange, error }: { value: number; onChange: (next: number) => void; error?: string | undefined }) {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-text">{t('sales.offers.days')}</legend>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((day) => {
          const on = (value & (1 << day)) !== 0;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(value ^ (1 << day))}
              className={cx('h-8 min-w-12 rounded-md border px-2.5 text-sm transition-colors', on ? 'border-text bg-text text-bg' : 'border-line bg-surface text-text hover:border-muted')}
            >
              {t(`sales.weekday.${day}`)}
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

/** The days and hours a rule runs at, in words: "Every day · All day", "Fri, Sat · 13:00–16:00". */
export function weekText(t: (key: string) => string, rule: { daysOfWeek: number; startMinute: number | null; endMinute: number | null }): string {
  const days = rule.daysOfWeek === ALL_DAYS ? t('sales.offers.everyDay') : DAYS.filter((day) => rule.daysOfWeek & (1 << day)).map((day) => t(`sales.weekday.${day}`)).join(', ');
  const hours = rule.startMinute === null ? t('sales.offers.allDay') : `${clock(rule.startMinute)}–${clock(rule.endMinute)}`;
  return `${days} · ${hours}`;
}

/** The times of day a rule runs at, in words. */
export function daypartsText(t: (key: string) => string, dayparts: readonly Daypart[]): string {
  return dayparts.length === 0 ? t('sales.dayparts.all') : dayparts.map((daypart) => t(`sales.daypart.${daypart}`)).join(', ');
}
