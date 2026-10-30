'use client';

import { localDigits } from '@/lib/digits';
import type { HoursRow } from '@/server/domain/about';
import type { Day } from '@/server/domain/restaurant-profile';
import { useApp } from '@/ui/AppProviders';

const WEEKDAY_KEYS: Record<Day, string> = {
  mon: 'offers.weekday.0',
  tue: 'offers.weekday.1',
  wed: 'offers.weekday.2',
  thu: 'offers.weekday.3',
  fri: 'offers.weekday.4',
  sat: 'offers.weekday.5',
  sun: 'offers.weekday.6',
};

/** The week, today marked in the menu's own time zone (the server says which day that is). A day with no range says Closed. */
export function HoursTable({ hours, today }: { hours: HoursRow[]; today: Day }) {
  const { t, tenant } = useApp();
  const digits = (time: string) => localDigits(time, tenant.numeralSystem);
  return (
    <table className="w-full text-start">
      <tbody>
        {hours.map((row) => (
          <tr key={row.day} aria-current={row.day === today ? 'date' : undefined} className={row.day === today ? 'font-medium text-text' : 'text-muted'}>
            <th scope="row" className="py-1.5 pe-4 text-start font-normal">
              {t(WEEKDAY_KEYS[row.day])}
              {row.day === today && <span className="ms-2 text-xs text-accent">{t('about.today')}</span>}
            </th>
            <td className="py-1.5 text-end">
              {row.ranges.length === 0
                ? t('about.closed')
                : row.ranges.map((range, index) => (
                    <span key={index} className="block" dir="ltr">
                      {digits(range.open)} – {digits(range.close)}
                    </span>
                  ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
