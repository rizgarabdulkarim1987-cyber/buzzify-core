import type { Translate } from '@/lib/i18n';
import { AUDIT_ACTIONS } from '@/server/domain/audit-actions';
import type { BusinessSector } from '@/server/domain/restaurant-profile';
import type { BusinessSpaceId, SpaceId } from './spaces';

/**
 * Each project's own words. The Studio's shared screens (a business's frame, its profile form, billing, people, the
 * activity log, announcements) were written for Menu and Cashier and say "restaurant", "menu", "till" and "guests". In
 * the Retail space none of that may show: every such text has a Retail twin, `retail.as.<key>`, in every language, and a
 * screen that may render in that space translates through `spaceT`, which swaps the key for its twin. Menu and Cashier
 * and the Pharmacy keep their texts as they are. `tests/studio/space-words.test.ts` is the word guard.
 */
export const RETAIL_WORDS = [
  // A shop's frame and its status
  'restaurants.tabs.label',
  'restaurants.notice.SUSPENDED',
  'restaurants.notice.ARCHIVED',
  'restaurants.suspend.title',
  'restaurants.suspend.body',
  'restaurants.archive.title',
  'restaurants.restore.title',
  'restaurants.archive.body',
  'restaurants.restore.body',
  'restaurants.statusDone.ACTIVE',
  'restaurants.statusDone.SUSPENDED',
  'restaurants.statusDone.ARCHIVED',
  // Its profile form, new and saved
  'restaurants.form.contactIntro',
  'restaurants.form.mapUrlHint',
  'restaurants.form.notesIntro',
  'restaurants.form.logoIntro',
  'restaurants.form.create',
  'restaurants.form.created',
  'restaurants.form.saved',
  'error.text.restaurantNameEnter',
  'restaurants.branches.emptyBody',
  'media.picker.intro',
  // Billing
  'billing.intro',
  'billing.trialRestaurantInactive',
  'billingSettings.intro',
  'billingSettings.noPlans',
  'billingSettings.empty',
  'error.text.billingSecondLive',
  'error.text.billingRestaurantNotActive',
  'error.text.billingReactivateRestaurantNotActive',
  'billingList.description',
  'billingList.restaurant',
  'billingList.emptyTitle',
  'billingList.emptyBody',
  'appPlans.deactivateBody',
  // People
  'restaurants.people.membersIntro',
  'people.access.none',
  'people.assign',
  'people.assign.body',
  'people.assign.restaurant',
  'people.owner.intro',
  'people.owner.restaurant',
  'people.owner.pick',
  'people.delete.body',
  'error.text.restaurantChoose',
  'error.text.personHasAccess',
  'error.text.tillAccount',
  'error.text.deleteHasTillHistory',
  // Activity
  'restaurants.activity.emptyBody',
  'restaurants.activity.caption',
  'activity.col.restaurant',
  'activity.filter.restaurant',
  'activity.filter.anyRestaurant',
  'activity.action.restaurant.created',
  'activity.action.app_plan.created',
  'activity.action.app_plan.updated',
  'activity.action.app_plan.deactivated',
  'activity.entity.Restaurant',
  'activity.entity.RestaurantStatus',
  'activity.entity.AppPlan',
  // Announcements
  'announcements.description',
  'announcements.emptyBody',
  'announcements.archiveBody',
  // Jump to
  'common.jumpToPlaceholder',
  'jump.restaurants',
] as const;

const RETAIL: ReadonlySet<string> = new Set(RETAIL_WORDS);

/** The Retail twin of a shared key. */
export const retailTwin = (key: string) => `retail.as.${key}`;

/** The space whose words a business of this sector is spoken of in. */
export function spaceOfSector(sector: BusinessSector): BusinessSpaceId {
  return sector === 'RETAIL' ? 'retail' : sector === 'PHARMACY' ? 'pharmacy' : 'food';
}

/** `t` in the words of `space`: in the Retail space a shared key with a Retail twin is read as its twin. */
export function spaceT(t: Translate, space: SpaceId | null | undefined): Translate {
  if (space !== 'retail') return t;
  return (key, params) => t(RETAIL.has(key) ? retailTwin(key) : key, params);
}

/** The actions that happen in the Retail space: its shops, their people and billing, its plans and announcements. */
const RETAIL_ACTION = /^(retail|branch|invitation|membership|subscription|payment|app_plan|announcement)\.|^restaurant\.(created|updated|status_changed)$/;

/**
 * The actions the activity filter of a space offers: only those that can happen there. Retail's are its own; Menu and
 * Cashier and the Pharmacy never list Retail's (`retail.*`).
 */
export function spaceActions(space: SpaceId): string[] {
  if (space === 'retail') return AUDIT_ACTIONS.filter((action) => RETAIL_ACTION.test(action));
  return AUDIT_ACTIONS.filter((action) => !action.startsWith('retail.'));
}
