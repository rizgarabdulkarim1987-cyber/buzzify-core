import type { SellSettings } from '@/server/pharmacy/sell-search';
import type { OpenShift } from './OpenShiftPanel';

/** What the person may do at the till, read from their role on the page (the server checks every call again). */
export interface SellPerms {
  /** discount.apply */
  discount: boolean;
  /** batch.override */
  batchOverride: boolean;
  /** rx.dispense */
  rx: boolean;
  /** credit.sell (and the business has switched credit on: the page sets this only when both hold) */
  credit: boolean;
}

/** The props every sell screen takes from the page: where, who, the open shift (null: the shift gate first), settings, permissions. */
export interface SellScreenProps {
  restaurantId: string;
  branchId: string;
  userId: string;
  shift: OpenShift | null;
  settings: SellSettings;
  perms: SellPerms;
}
