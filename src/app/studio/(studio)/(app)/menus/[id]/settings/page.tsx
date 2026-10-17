import type { Metadata } from 'next';
import { hostEnv } from '@/server/env';
import { query } from '@/server/studio/framework/invoke';
import * as menuQueries from '@/server/studio/queries/menus';
import { OFFERED_CURRENCIES, OFFERED_TIME_ZONES } from '@/server/studio/services/menus';
import { SettingsForm } from '@/studio/workspace/SettingsForm';
import { loadMenu, tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'settings');
}

/** The Settings tab: the menu's name, address, languages, currency, rounding step, search text and notes. */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [menu, settings] = await Promise.all([loadMenu(id), query(menuQueries.settings, { menuId: id })]);
  return (
    <SettingsForm
      key={settings.version}
      menuId={id}
      restaurantId={menu.restaurant.id}
      origin={hostEnv().publicOrigin}
      settings={settings}
      currencies={OFFERED_CURRENCIES}
      timeZones={OFFERED_TIME_ZONES}
    />
  );
}
