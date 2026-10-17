'use client';

import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DAYS, MAX_RANGES_PER_DAY, type Day, type WorkingHours } from '@/server/domain/restaurant-profile';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { CONTROL_CLASSES } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';

export interface WorkingHoursFieldProps {
  /** The name of the hidden field that carries the hours as JSON. */
  name: string;
  defaultValue: WorkingHours;
  /** What is wrong with the hours, in the person's language. */
  error?: string | undefined;
  /** Moves focus to the hours when they are what was refused (nothing else was, so nothing else takes it). */
  focusOnError?: boolean;
  /** Counts the submits: a refusal repeated with the same words moves focus again. */
  attempt?: number;
}

/** The hours as the form sends them: one hidden field holding the JSON that the server's schema reads. */
export function parseHours(value: string | undefined): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

const TIME_INPUT = cx(CONTROL_CLASSES, 'h-8 w-[7.25rem] px-2 text-base tabular-nums');

/**
 * Opening hours for the seven days: up to three ranges for each, as a pair of times. A closing time before the opening
 * time means after midnight, which the hint says. The state lives here and goes out through one hidden field, so the
 * form's own handling of text fields needs no knowledge of ranges.
 */
export function WorkingHoursField({ name, defaultValue, error, focusOnError = false, attempt = 0 }: WorkingHoursFieldProps) {
  const t = useT();
  const [hours, setHours] = useState<WorkingHours>(defaultValue);
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error && focusOnError) group.current?.focus();
  }, [error, focusOnError, attempt]);

  const change = (day: Day, update: (ranges: WorkingHours[Day]) => WorkingHours[Day]) =>
    setHours((current) => ({ ...current, [day]: update(current[day]) }));

  return (
    <div
      ref={group}
      tabIndex={-1}
      role="group"
      aria-label={t('restaurants.form.hours')}
      aria-describedby={error ? `${name}-error` : undefined}
      className="flex flex-col outline-none"
    >
      <input type="hidden" name={name} value={JSON.stringify(hours)} />
      <ul className="divide-y divide-line border-y border-line">
        {DAYS.map((day) => {
          const dayName = t(`restaurants.hours.day.${day}`);
          const ranges = hours[day];
          return (
            <li key={day} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 py-2">
              <span className="w-24 shrink-0 text-base font-medium text-text">{dayName}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {ranges.length === 0 && <span className="text-base text-muted">{t('restaurants.hours.closed')}</span>}
                {ranges.map((range, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="time"
                      dir="ltr"
                      required
                      aria-label={t('restaurants.hours.opens', { day: dayName })}
                      aria-invalid={error ? true : undefined}
                      value={range[0]}
                      onChange={(event) =>
                        change(day, (current) => current.map((item, at) => (at === index ? [event.target.value, item[1]] : item)))
                      }
                      className={TIME_INPUT}
                    />
                    <span aria-hidden className="text-muted">
                      {t('restaurants.hours.to')}
                    </span>
                    <input
                      type="time"
                      dir="ltr"
                      required
                      aria-label={t('restaurants.hours.closes', { day: dayName })}
                      aria-invalid={error ? true : undefined}
                      value={range[1]}
                      onChange={(event) =>
                        change(day, (current) => current.map((item, at) => (at === index ? [item[0], event.target.value] : item)))
                      }
                      className={TIME_INPUT}
                    />
                    <IconButton
                      label={t('restaurants.hours.removeLabel', { day: dayName })}
                      icon={<X aria-hidden />}
                      size="sm"
                      onClick={() => change(day, (current) => current.filter((_, at) => at !== index))}
                    />
                  </div>
                ))}
              </div>
              {ranges.length < MAX_RANGES_PER_DAY && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus aria-hidden />}
                  aria-label={t('restaurants.hours.addLabel', { day: dayName })}
                  onClick={() => change(day, (current) => [...current, current.length === 0 ? ['09:00', '23:00'] : ['18:00', '23:00']])}
                >
                  {t('restaurants.hours.add')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p id={`${name}-error`} className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
