import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { EditRestaurantForm } from '../RestaurantForm';
import { WorkingHoursList } from '../WorkingHoursList';
import { loadRestaurant } from './load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const restaurant = await loadRestaurant((await params).id);
  return { title: restaurant.name };
}

/**
 * The profile. Someone who may edit the restaurant gets the form; anyone else (an owner, by default) reads it. The form
 * is keyed by the version it opened at, so a reload or a save starts it again from what is stored.
 */
export default async function RestaurantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const restaurant = await loadRestaurant(id);

  if (restaurant.can.edit) {
    return (
      <div className="px-8 pb-2">
        <EditRestaurantForm
          key={`${restaurant.id}:${restaurant.version}`}
          restaurantId={restaurant.id}
          version={restaurant.version}
          initial={restaurant}
          logo={restaurant.logo}
        />
      </div>
    );
  }

  const rows: Array<[string, string]> = [
    [t('restaurants.form.description'), restaurant.description],
    [t('restaurants.form.address'), restaurant.address],
    [t('restaurants.form.city'), restaurant.city],
    [t('restaurants.form.country'), restaurant.country],
    [t('restaurants.form.phone'), restaurant.phone],
    [t('restaurants.form.whatsapp'), restaurant.whatsapp],
    [t('restaurants.form.instagram'), restaurant.socialLinks.instagram],
    [t('restaurants.form.facebook'), restaurant.socialLinks.facebook],
    [t('restaurants.form.tiktok'), restaurant.socialLinks.tiktok],
    [t('restaurants.form.website'), restaurant.socialLinks.website],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-8 px-8 py-6">
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-base">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="whitespace-pre-line break-words text-text">{value || <span className="text-muted">{t('restaurants.summary.notSet')}</span>}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="hours" className="flex flex-col gap-3">
        <h2 id="hours" className="text-md font-semibold text-text">
          {t('restaurants.form.hours')}
        </h2>
        <WorkingHoursList hours={restaurant.workingHours} t={t} />
      </section>
    </div>
  );
}
