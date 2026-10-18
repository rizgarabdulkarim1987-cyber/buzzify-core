/**
 * What a restaurant's profile is made of, as plain data: its types and statuses, client IDs, and the shape of its working
 * hours. Pure, so the Studio's server code and its forms share one definition (the pages may not import the database
 * client, so they cannot take these from the generated enums).
 */

export const RESTAURANT_TYPES = ['CAFE', 'RESTAURANT', 'BAKERY', 'ICE_CREAM', 'FAST_FOOD', 'FINE_DINING', 'OTHER'] as const;
export type RestaurantType = (typeof RESTAURANT_TYPES)[number];

export const RESTAURANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

// Client IDs -----------------------------------------------------------------------------------------------------------

/** The client ID staff say and search for: `BZ-0001`. Numbers of more than four digits print in full. */
export function formatClientId(n: number): string {
  return `BZ-${String(Math.trunc(n)).padStart(4, '0')}`;
}

/** `BZ-0007`, `bz-0007`, `bz7` and `BZ 7` are all client 7. Anything else (a plain number, a name) is not a client ID. */
const CLIENT_ID = /^bz\s*-?\s*(\d{1,9})$/i;

/** The client number a typed client ID names, or null when the text is not one. */
export function parseClientId(text: string): number | null {
  const match = CLIENT_ID.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? n : null;
}

// Working hours --------------------------------------------------------------------------------------------------------

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

/** Opening and closing time of one range, `HH:MM` on a 24-hour clock. A closing time before the opening time is after midnight. */
export type TimeRange = [string, string];

export type WorkingHours = Record<Day, TimeRange[]>;

/** Most ranges one day may have (a lunch and a dinner service, and a late one). */
export const MAX_RANGES_PER_DAY = 3;

export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptyWorkingHours(): WorkingHours {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

/**
 * Reads stored working hours (JSON written by the Studio, or by hand): days it does not know are dropped, a day that is
 * missing or malformed is closed, and a range that is not two valid times is dropped. Never throws.
 */
export function readWorkingHours(json: unknown): WorkingHours {
  const hours = emptyWorkingHours();
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return hours;
  const stored = json as Record<string, unknown>;
  for (const day of DAYS) {
    const ranges = stored[day];
    if (!Array.isArray(ranges)) continue;
    for (const range of ranges.slice(0, MAX_RANGES_PER_DAY)) {
      if (!Array.isArray(range) || range.length !== 2) continue;
      const [open, close] = range as unknown[];
      if (typeof open === 'string' && typeof close === 'string' && TIME_OF_DAY.test(open) && TIME_OF_DAY.test(close)) {
        hours[day].push([open, close]);
      }
    }
  }
  return hours;
}

// Social links ---------------------------------------------------------------------------------------------------------

export const SOCIAL_NETWORKS = ['instagram', 'facebook', 'tiktok', 'website'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type SocialLinks = Record<SocialNetwork, string>;

/** Stored social links as the form edits them: the four networks, empty where there is no link. */
export function readSocialLinks(json: unknown): SocialLinks {
  const links: SocialLinks = { instagram: '', facebook: '', tiktok: '', website: '' };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return links;
  const stored = json as Record<string, unknown>;
  for (const network of SOCIAL_NETWORKS) {
    const link = stored[network];
    if (typeof link === 'string') links[network] = link;
  }
  return links;
}
