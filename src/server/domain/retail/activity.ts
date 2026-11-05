/**
 * The three Buzzify Retail products a RETAIL business is one of: a supermarket, an electronics shop or a clothing shop.
 * The sector stays RETAIL (its database enum never grows); the product is `RetailLink.activity`, set when the shop is
 * created and never changed from the Studio's screens (support only). Each product is a closed space of its own in the
 * Super Admin's hub (`src/studio/spaces.ts`). Pure: no database, safe on the client.
 */

export const RETAIL_ACTIVITIES = ['SUPERMARKET', 'ELECTRONICS', 'CLOTHING'] as const;
export type RetailActivity = (typeof RETAIL_ACTIVITIES)[number];

/** What a shop that predates the three products is, and what a RETAIL business made without a product becomes. */
export const DEFAULT_RETAIL_ACTIVITY: RetailActivity = 'SUPERMARKET';

/** Retails' own `activityType` (its enum is MARKET | CLOTHING | ELECTRONICS | BEAUTY | STATIONERY | MIXED). */
export type RetailsActivityType = 'MARKET' | 'ELECTRONICS' | 'CLOTHING';

const RETAILS_TYPE: Record<RetailActivity, RetailsActivityType> = { SUPERMARKET: 'MARKET', ELECTRONICS: 'ELECTRONICS', CLOTHING: 'CLOTHING' };

/** The `activityType` Studio sends Retails for a product. */
export const retailsActivityType = (activity: RetailActivity): RetailsActivityType => RETAILS_TYPE[activity];

export const isRetailActivity = (value: unknown): value is RetailActivity => typeof value === 'string' && (RETAIL_ACTIVITIES as readonly string[]).includes(value);
