import { Fragment } from 'react';
import type { Translate } from '@/lib/i18n';
import { DAYS, type WorkingHours } from '@/server/domain/restaurant-profile';

/** Opening hours as the team reads them: a line for each day, "Closed" where there are none. */
export function WorkingHoursList({ hours, t }: { hours: WorkingHours; t: Translate }) {
  return (
    <dl className="grid max-w-md grid-cols-[7rem_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-base">
      {DAYS.map((day) => (
        <Fragment key={day}>
          <dt className="text-muted">{t(`restaurants.hours.day.${day}`)}</dt>
          <dd className="text-text tabular-nums">
            {hours[day].length === 0 ? (
              <span className="text-muted">{t('restaurants.hours.closed')}</span>
            ) : (
              <span dir="ltr" className="inline-block">
                {hours[day].map(([open, close]) => `${open}–${close}`).join(', ')}
              </span>
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
