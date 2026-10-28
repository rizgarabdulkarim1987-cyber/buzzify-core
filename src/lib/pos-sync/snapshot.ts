import type { Locale } from '@/lib/locale';
import type { OrderStatus } from '@/server/domain/pos/order-state';
import type { Discount, Rates } from '@/server/domain/pos/totals';
import type { TillCatalog } from '@/server/pos/till-catalog';

/**
 * What a till device keeps to work from while offline: the floor, what the till sells and the live orders with their
 * versions. Types only, shared by the server that reads it and the device that stores it.
 */

export interface SnapshotLine {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  /** What the menu's offer took off one unit, in whole IQD (0: none). */
  promoPerUnit: number;
  options: { id: string; name: string; priceDelta: number }[];
  note: string;
  discount: Discount | null;
  cancelled: boolean;
  sent: boolean;
}

export interface SnapshotOrder {
  id: string;
  number: number;
  status: OrderStatus;
  version: number;
  tableId: string;
  seatedAt: string;
  invoiceDiscount: Discount | null;
  /** A part of the bill is already paid: the rest is priced online, so the offline till cannot take it. */
  partPaid?: boolean;
  lines: SnapshotLine[];
}

export interface SyncSnapshot {
  serverTime: string;
  restaurantId: string;
  user: { id: string; name: string; locale: Locale; can: { discount: boolean; cancel: boolean; pay: boolean } };
  /** The service and tax rates, and the dinar step the payable total rounds to (absent: no rounding). */
  rates: Rates & { roundingStep?: number };
  kitchen: { print: boolean; screen: boolean };
  catalog: TillCatalog | null;
  areas: { id: string; name: string; tables: { id: string; number: number }[] }[];
  /** Live dine-in orders, one per table at most. */
  orders: SnapshotOrder[];
  openShift: { id: string } | null;
}
